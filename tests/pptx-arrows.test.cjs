'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const fflate=require('../assets/vendor/fflate.min.js');
const window={fflate};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assets/vendor/flowsketch-pptx.js'),'utf8'),{window,Uint8Array});
const EMU=9525;
const connector=(extra={})=>({type:'connector',a:{x:100,y:100},b:{x:300,y:100},color:'#123456',opacity:.35,width:2,arrowWidth:25,arrowLength:25,startStyle:'none',endStyle:'triangle',...extra});
async function slide(items){const bytes=await window.FlowSketchPptx.generate({width:800,height:600,items,media:[]});const files=fflate.unzipSync(bytes);assert.ok(files['ppt/presentation.xml']);assert.equal(Object.keys(files).filter(x=>x.startsWith('ppt/media/')).length,0);return fflate.strFromU8(files['ppt/slides/slide1.xml'])}
function arrows(xml){return [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map(m=>m[0]).filter(s=>/name="[^"]* (?:start|end) arrow"/.test(s))}
function geometry(shape){let off=shape.match(/<a:off x="(-?\d+)" y="(-?\d+)"/),ext=shape.match(/<a:ext cx="(\d+)" cy="(\d+)"/);return{x:+off[1]/EMU,y:+off[2]/EMU,w:+ext[1]/EMU,h:+ext[2]/EMU,points:[...shape.matchAll(/<a:pt x="(-?\d+)" y="(-?\d+)"/g)].map(m=>({x:(+off[1]+ +m[1])/EMU,y:(+off[2]+ +m[2])/EMU}))}}
const near=(actual,expected,tolerance=.002)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
test('25 and 100 pixel arrows retain proportional native geometry and suppress standard line arrows',async()=>{
  const small=await slide([connector()]),large=await slide([connector({arrowWidth:100,arrowLength:100})]);assert.notEqual(small,large);
  const a=geometry(arrows(small)[0]),b=geometry(arrows(large)[0]);near(b.w,a.w*4);near(b.h,a.h*4);
  assert.match(small,/<a:custGeom>/);assert.doesNotMatch(small,/<a:(?:head|tail)End type="(?:triangle|stealth|arrow|diamond|oval)"/);
});
test('line width, dash and opacity do not alter arrow geometry or add dashed marker strokes',async()=>{
  const a=arrows(await slide([connector({width:.25})]))[0],b=arrows(await slide([connector({width:35,dash:true})]))[0];assert.equal(a,b);
  assert.match(a,/srgbClr val="123456"/);assert.match(a,/alpha val="35000"/);assert.match(a,/<a:ln><a:noFill\/><\/a:ln>/);assert.doesNotMatch(a,/prstDash/);
});
for(const style of ['triangle','stealth','open','diamond','circle'])test(`${style} supports separately scaled width and length including extreme aspect ratios`,async()=>{
  const wide=geometry(arrows(await slide([connector({endStyle:style,arrowWidth:100,arrowLength:4})]))[0]);
  const long=geometry(arrows(await slide([connector({endStyle:style,arrowWidth:4,arrowLength:100})]))[0]);near(wide.w*25,long.w);near(long.h*25,wide.h);
  const svg=arrows(await slide([connector({endStyle:style})]))[0];if(['circle','open'].includes(style))assert.match(svg,/<a:cubicBezTo>/);else assert.doesNotMatch(svg,/<a:cubicBezTo>/);
});
test('each marker style has distinct geometry; outline-expanded circle uses refX 8.2',async()=>{
  const styles=['triangle','stealth','open','diamond','circle'];const values=await Promise.all(styles.map(async endStyle=>arrows(await slide([connector({endStyle})]))[0].match(/<a:custGeom>[\s\S]*?<\/a:custGeom>/)[0]));assert.equal(new Set(values).size,5);
  const g=geometry(arrows(await slide([connector({endStyle:'circle',arrowWidth:80,arrowLength:100})]))[0]);near(g.x,231);near(g.y,63);near(g.w,74);near(g.h,74);
});
test('start and end arrows point outwards for horizontal, vertical and diagonal connectors',async()=>{
  for(const b of [{x:300,y:100},{x:100,y:300},{x:300,y:300},{x:0,y:0}]){const [start,end]=arrows(await slide([connector({b,startStyle:'triangle'})])).map(geometry),dx=b.x-100,dy=b.y-100;const projection=(p,tip)=>((p.x-tip.x)*dx+(p.y-tip.y)*dy)/Math.hypot(dx,dy);const avg=(g,tip)=>g.points.reduce((sum,p)=>sum+projection(p,tip),0)/g.points.length;assert.ok(avg(start,{x:100,y:100})>0);assert.ok(avg(end,b)<0)}
});
test('curves skip degenerate endpoint legs and follow their actual first and last control points',async()=>{
  const item=connector({type:'curve',arrowLength:50,arrowWidth:10,a:{x:100,y:100},sa:{x:100,y:100},c1:{x:100,y:180},c2:{x:240,y:300},eb:{x:300,y:300},b:{x:300,y:300},startStyle:'triangle'});
  const [start,end]=arrows(await slide([item])).map(geometry);assert.ok(start.h>start.w);assert.ok(start.points.reduce((sum,p)=>sum+p.y,0)/start.points.length>100);assert.ok(end.w>end.h);assert.ok(end.x<300);
  const allSame=Object.fromEntries(['a','sa','c1','c2','eb','b'].map(key=>[key,{x:100,y:100}]));assert.equal(arrows(await slide([{...item,...allSame}])).length,0);
});
test('polyline marker directions skip repeated endpoints and remain next to their own line in layer order',async()=>{
  const item=connector({type:'path',arrowLength:50,arrowWidth:10,name:'Route',points:[{x:100,y:100},{x:100,y:100},{x:100,y:200},{x:300,y:200},{x:300,y:200}],startStyle:'open',endStyle:'diamond'});
  const xml=await slide([item,{type:'shape',name:'Foreground',x:0,y:0,w:20,h:20,fill:'#ffffff'}]);const [start,end]=arrows(xml).map(geometry);assert.ok(start.h>start.w);assert.ok(end.w>end.h);
  const names=[...xml.matchAll(/<p:cNvPr id="(\d+)" name="([^"]*)"/g)];assert.deepEqual(names.map(m=>m[2]),['','Route','Route start arrow','Route end arrow','Foreground']);assert.equal(new Set(names.map(m=>m[1])).size,names.length);
});
test('zero dimensions suppress markers and legacy oversized pixel dimensions remain untruncated',async()=>{
  for(const dimensions of [{arrowWidth:0},{arrowLength:0},{arrowWidth:0,arrowLength:0}]){const xml=await slide([connector(dimensions)]);assert.equal(arrows(xml).length,0);assert.doesNotMatch(xml,/<a:(?:head|tail)End type="triangle"/)}
  const a=geometry(arrows(await slide([connector()]))[0]),b=geometry(arrows(await slide([connector({arrowWidth:240,arrowLength:320})]))[0]);near(b.w,a.w*320/25);near(b.h,a.h*240/25);
});
test('external scenes without explicit pixel dimensions preserve native standard arrow compatibility',async()=>{
  const item=connector({startStyle:'open',endStyle:'circle'});delete item.arrowWidth;delete item.arrowLength;const xml=await slide([item]);assert.equal(arrows(xml).length,0);assert.match(xml,/<a:headEnd type="arrow" w="med" len="med"\/>/);assert.match(xml,/<a:tailEnd type="oval" w="med" len="med"\/>/);
});
