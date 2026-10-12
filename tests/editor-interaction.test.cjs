'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8');
function dropHarness(){
  const listeners=[],imported=[];let overlay=false;
  const context={previewMode:false,dragDepth:0,hasDraggedFiles:e=>e.dataTransfer.types.includes('Files'),
    document:{addEventListener:(type,fn,capture)=>listeners.push({type,fn,capture}),visibilityState:'visible'},window:{addEventListener(){}},
    $:()=>({classList:{add:()=>overlay=true,remove:()=>overlay=false}}),handleDroppedFiles:async files=>imported.push(files)};
  const start=html.indexOf('  function isAIDrop('),end=html.indexOf("  window.addEventListener('keydown'",start);
  vm.runInNewContext(html.slice(start,end),context);
  async function dispatch(type,ai){const event={target:{closest:()=>ai?{}:null},dataTransfer:{types:['Files'],files:['fixture.png']},preventDefault(){this.prevented=true}};
    for(const listener of listeners.filter(l=>l.type===type).sort((a,b)=>Number(Boolean(b.capture))-Number(Boolean(a.capture))))await listener.fn(event);return event}
  return {dispatch,imported,overlay:()=>overlay,context};
}
test('moving a canvas file drag into the AI panel clears the global overlay and never imports it',async()=>{
  const h=dropHarness();await h.dispatch('dragenter',false);assert.equal(h.overlay(),true);
  await h.dispatch('dragover',true);assert.equal(h.overlay(),false);assert.equal(h.context.dragDepth,0);
  await h.dispatch('drop',true);assert.equal(h.imported.length,0);
});
test('dropping outside AI retains native canvas import',async()=>{
  const h=dropHarness();await h.dispatch('dragenter',false);const e=await h.dispatch('drop',false);
  assert.equal(e.prevented,true);assert.deepEqual(h.imported,[['fixture.png']]);assert.equal(h.overlay(),false);
});
test('an open image modal prevents canvas undo and deletion shortcuts',()=>{
  const handlers={},calls=[];const start=html.indexOf("  window.addEventListener('keydown'"),end=html.indexOf("window.addEventListener('keyup'",start);
  vm.runInNewContext(html.slice(start,end),{window:{addEventListener:(type,fn)=>handlers[type]=fn},$:()=>({classList:{contains:()=>true}}),closeModal:()=>calls.push('close'),undo:()=>calls.push('undo'),remove:()=>calls.push('remove')});
  handlers.keydown({key:'z',ctrlKey:true});handlers.keydown({key:'Delete'});assert.deepEqual(calls,[]);
  handlers.keydown({key:'Escape'});assert.deepEqual(calls,['close']);
});
for(const change of ['undo','color'])test(`image export discards an async result after ${change}`,async()=>{
  const image={id:'one',type:'image',src:'original',transparentColor:'#ffffff',colorTolerance:24},cache=new WeakMap(),writes=[];
  let current=image,resolve;const pending=new Promise(r=>resolve=r);
  const context={project:{elements:[image]},imageExportSources:cache,el:()=>current,canvas:{querySelectorAll:()=>[{dataset:{id:'one'},querySelector:()=>({replaceChildren:()=>writes.push('write')})}]},window:{FlowSketchImages:{ensureSourceSize:async()=>{},prepareSource:()=>pending,createElement:()=>({})}}};
  const start=html.indexOf('  function imageExportKey('),end=html.indexOf('\n  async function exportPNG',start);
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);
  const operation=context.prepareImageExports();await Promise.resolve();
  if(change==='undo')current={...image};else image.transparentColor='#000000';
  resolve('processed-old-color');await assert.rejects(operation,/已变化/);
  assert.equal(cache.has(image),false);assert.deepEqual(writes,[]);
});
