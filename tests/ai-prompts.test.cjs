'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
globalThis.katex=require('../assets/vendor/katex.min.js');
require('../assets/js/ai-engine.js');
require('../assets/js/ai-prompts.js');
const engine=globalThis.FlowSketchAIEngine,prompts=globalThis.FlowSketchAIPrompts;
const fresh=()=>({name:'Test',canvas:{width:1400,height:900},elements:[],groups:[]});
const assets={reference_example:{src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a42sAAAAASUVORK5CYII=',name:'参考',width:1,height:1}};
const add=element=>({op:'add',element:{id:'node',type:'basicShape',...element}});

test('every published example applies atomically with the real editor validator',()=>{
  for(const example of prompts.examples()) {
    const source=fresh();
    const output=engine.apply(source,example.operations,assets);
    assert.ok(output.elements.length,example.label);
    assert.equal(source.elements.length,0);
  }
});

test('field contract advertises actual boolean and numerical rejection boundaries',()=>{
  const c=engine.contract();
  for(const [field,schema] of Object.entries(c.fields)) {
    const type=c.canvasFields.includes(field)?null:c.addTypes.find(type=>c.elementFields[type].includes(field));
    if(type===undefined)continue;
    const operation=value=>type===null?{op:'canvas',changes:{[field]:value}}:{op:'add',element:{id:'node',type,...(type==='image'?{assetId:'reference_example'}:{}),[field]:value}};
    if(schema.type==='boolean') {
      for(const value of ['true','false',0,1,[]])assert.throws(()=>engine.apply(fresh(),[operation(value)],assets),/必须是布尔值/,field);
      assert.doesNotThrow(()=>engine.apply(fresh(),[operation(false)],assets),field);
    }
    if(['number','integer'].includes(schema.type)) {
      for(const value of [schema.minimum-1,schema.maximum+1,String(schema.minimum)])
        assert.throws(()=>engine.apply(fresh(),[operation(value)],assets),/数值超出范围/,field);
      if(schema.type==='integer')assert.throws(()=>engine.apply(fresh(),[operation(schema.minimum+.5)],assets),/数值超出范围/,field);
    }
  }
  assert.throws(()=>engine.apply(fresh(),[add({dash:'dashed'})]),/dash 必须是布尔值/);
  assert.throws(()=>engine.apply(fresh(),[add({opacity:2})]),/0～1 的有限数值/);
  assert.throws(()=>engine.apply(fresh(),[{op:'add',element:{id:'grid',type:'tokenGrid',rows:1.5}}]),/1～100 的整数/);
});

test('contract differentiates Token offsets and group offsets without weakening validation',()=>{
  const c=engine.contract();
  assert.equal(c.fields.stackX.minimum,0);
  assert.equal(c.groupFields.stackX.minimum,-200);
  assert.throws(()=>engine.apply(fresh(),[{op:'add',element:{id:'grid',type:'tokenGrid',stackX:-10}}]),/数值超出范围/);
  const ops=[add({}),{op:'group',id:'g',changes:{memberIds:['node'],stackX:-10,autoStack:false}}];
  assert.equal(engine.apply(fresh(),ops).groups[0].stackX,-10);
  assert.throws(()=>engine.apply(fresh(),[add({}),{op:'group',id:'g',changes:{memberIds:['node'],autoStack:'false'}}]),/布尔值/);
});

test('tool operations require the right payload and constrain nested fields',()=>{
  const parameters=prompts.tool().function.parameters;
  assert.deepEqual(parameters.required,['operations']);
  assert.equal(parameters.additionalProperties,false);
  const branches=parameters.properties.operations.items.anyOf;
  const find=op=>branches.find(branch=>branch.properties.op.enum[0]===op);
  for(const op of ['add','update','delete','canvas','rename','clear','group','ungroup']) {
    const branch=find(op);
    assert.deepEqual(Object.keys(branch.properties),engine.contract().operationFields[op]);
    assert.deepEqual(branch.required,engine.contract().operationFields[op]);
    assert.equal(branch.additionalProperties,false);
  }
  const update=find('update').properties.changes;
  assert.equal(update.properties.dash.type,'boolean');
  assert.equal(update.properties.opacity.minimum,0);
  assert.equal(update.properties.opacity.maximum,1);
  assert.equal(update.properties.rows.type,'integer');
  for(const forbidden of ['id','type','groupId','src','poolColors'])assert.equal(update.properties[forbidden],undefined);
  assert.equal(update.additionalProperties,false);
  const elements=find('add').properties.element.anyOf;
  const formula=elements.find(s=>s.properties.type.enum[0]==='formula');
  const connector=elements.find(s=>s.properties.type.enum[0]==='connector');
  const text=elements.find(s=>s.properties.type.enum[0]==='text');
  assert.equal(formula.properties.dash,undefined);
  assert.equal(connector.properties.w,undefined);
  assert.equal(text.properties.gradientColors,undefined);
  assert.deepEqual(elements.map(s=>s.properties.type.enum[0]),engine.contract().addTypes);
});

test('both modes carry shared constraints and only the current canvas context',()=>{
  const snapshot=engine.describe(engine.apply(fresh(),[add({text:'current'})]));
  for(const mode of ['json','tools']) {
    const prompt=prompts.instructions(snapshot,mode);
    assert.ok(prompt.includes('dash:"dashed"'));
    assert.ok(prompt.includes('type=integer'));
    assert.ok(prompt.includes(JSON.stringify(engine.contract())));
    assert.ok(prompt.includes(JSON.stringify(snapshot)));
    assert.ok(prompt.endsWith('[]'));
    assert.ok(!prompt.includes('example_image'));
    assert.ok(prompt.includes('cellColors.length 必须等于 rows*cols'));
  }
  assert.ok(prompts.instructions(snapshot,'json').includes('```flowsketch'));
  assert.ok(prompts.instructions(snapshot,'tools').includes('原生 JSON 参数'));
});

test('contract and examples cannot mutate future validation or prompts',()=>{
  const c=engine.contract();
  c.addTypes.push('image');c.fields.shapeKind.enum.push('invalid');c.elementFields.formula.push('dash');
  const samples=prompts.examples();samples[0].operations[0].element.dash='false';
  assert.throws(()=>engine.apply(fresh(),[add({shapeKind:'invalid'})]),/枚举无效/);
  assert.equal(engine.contract().elementFields.formula.includes('dash'),false);
  assert.equal(prompts.examples()[0].operations[0].element.dash,false);
});

test('image tool requires a trusted asset reference and types crop, flips without exposing update source',()=>{
  const branches=prompts.tool().function.parameters.properties.operations.items.anyOf;
  const image=branches.find(b=>b.properties.op.enum[0]==='add').properties.element.anyOf.find(s=>s.properties.type.enum[0]==='image');
  assert.deepEqual(image.required,['id','type','assetId']);
  assert.equal(image.properties.src,undefined);assert.equal(image.properties.gradientColors,undefined);
  assert.equal(image.properties.flipX.type,'boolean');assert.equal(image.properties.crop.anyOf[0].properties.w.exclusiveMinimum,0);
  const update=branches.find(b=>b.properties.op.enum[0]==='update').properties.changes;
  assert.equal(update.properties.assetId,undefined);assert.equal(update.properties.crop.anyOf[1].type,'null');
  const prompt=prompts.instructions(engine.describe(fresh()),'tools',[{assetId:'reference_actual',name:'参考',width:1,height:1,src:assets.reference_example.src}]);
  assert.ok(prompt.includes('reference_actual'));assert.ok(!prompt.includes('reference_example'));assert.ok(!prompt.includes('base64'));assert.ok(prompt.includes('空列表禁止新增图片'));
});

test('image transparent color contract is nullable strict RGB and bounded integer tolerance',()=>{
  const c=engine.contract();assert.deepEqual(c.fields.transparentColor.anyOf,[{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},{type:'null'}]);
  assert.deepEqual(c.fields.colorTolerance,{type:'integer',minimum:0,maximum:255});
  for(const type of c.addTypes)for(const field of ['transparentColor','colorTolerance'])assert.equal(c.elementFields[type].includes(field),type==='image');
  const branches=prompts.tool().function.parameters.properties.operations.items.anyOf;
  const image=branches.find(b=>b.properties.op.enum[0]==='add').properties.element.anyOf.find(s=>s.properties.type.enum[0]==='image');
  const update=branches.find(b=>b.properties.op.enum[0]==='update').properties.changes;
  assert.deepEqual(image.properties.transparentColor,c.fields.transparentColor);assert.deepEqual(update.properties.colorTolerance,c.fields.colorTolerance);
  const prompt=prompts.instructions(engine.describe(fresh()),'json');assert.ok(prompt.includes('去白底'));assert.ok(prompt.includes('默认24'));
});
