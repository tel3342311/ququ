import test from 'node:test';
import assert from 'node:assert/strict';
import {observeInterfaceMode,requestInterfaceMode} from './interface-mode.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('a delayed initial mode read cannot overwrite a newer tray event',async()=>{
 let event,resolve;const modes=[];const api={onInterfaceModeChanged:fn=>{event=fn;return()=>{}},getInterfaceMode:()=>new Promise(r=>resolve=r)};
 const observer=observeInterfaceMode(api,value=>modes.push(value),assert.fail);
 event({}, {mode:'compact'});resolve('classic');await tick();assert.deepEqual(modes,['compact']);observer.dispose();
});
test('disposed observers ignore outstanding reads and events',async()=>{
 let event,resolve,released=0;const modes=[];const observer=observeInterfaceMode({onInterfaceModeChanged:fn=>{event=fn;return()=>released++},getInterfaceMode:()=>new Promise(r=>resolve=r)},m=>modes.push(m),assert.fail);
 observer.dispose();observer.dispose();resolve('classic');event({}, {mode:'compact'});await tick();assert.deepEqual(modes,[]);assert.equal(released,1);
});
test('switches are refused during every busy phase without calling native API',async()=>{
 let calls=0;const api={setInterfaceMode:async()=>{calls++;return{success:true}}};
 for(const phase of ['starting','recording','processing','optimizing'])await assert.rejects(requestInterfaceMode(api,'classic',phase),/完成/);
 assert.equal(calls,0);await requestInterfaceMode(api,'classic','idle');assert.equal(calls,1);
});
test('invalid mode and failed native changes never report success',async()=>{
 await assert.rejects(requestInterfaceMode({},'other'),/介面/);
 await assert.rejects(requestInterfaceMode({setInterfaceMode:async()=>({success:false,error:'busy'})},'compact'),/busy/);
});

test('initial snapshot waits until the asynchronous native listener is installed',async()=>{
 let installed,reads=0,event;const ready=new Promise(resolve=>installed=resolve);const dispose=()=>{};dispose.ready=ready;
 const modes=[];const observer=observeInterfaceMode({onInterfaceModeChanged:fn=>{event=fn;return dispose;},getInterfaceMode:async()=>{reads++;return 'compact';}},mode=>modes.push(mode),assert.fail);
 assert.equal(reads,0);installed();await tick();assert.equal(reads,1);assert.deepEqual(modes,['compact']);observer.dispose();
});
