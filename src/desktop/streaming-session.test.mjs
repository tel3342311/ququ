import test from 'node:test';
import assert from 'node:assert/strict';
import {StreamingSession} from './streaming-session.mjs';
import {floatToInt16} from './pcm.mjs';

function harness({pushDelay=()=>0,pushResult=(n)=>({success:true,draft:`d${n}`}),start={success:true,session:7}}={}) {
  const log=[],drafts=[],errors=[];let emit,captureStopped=0,pushes=0;
  const api={
    streamStart:async()=>{log.push('start');return start;},
    streamPush:async(id,chunk)=>{const n=++pushes;log.push(`push${n}:${chunk[0]}`);await new Promise(r=>setTimeout(r,pushDelay(n)));return pushResult(n);},
    streamFinish:async id=>{log.push(`finish${id}`);return{success:true,text:'final'};},
    streamCancel:async id=>{log.push(`cancel${id}`);return{success:true};},
  };
  const createCapture=async onChunk=>{emit=onChunk;return{stop:async()=>{captureStopped++;emit([99]);}};};
  const session=new StreamingSession({api,createCapture,onDraft:d=>drafts.push(d),onError:e=>errors.push(e.message)});
  return{session,log,drafts,errors,emit:c=>emit(c),stopped:()=>captureStopped};
}

test('pushes chunks in order, surfaces drafts, and drains before finishing',async()=>{
  const h=harness({pushDelay:n=>n===1?20:0});
  assert.equal(await h.session.start(),true);
  h.emit([1]);h.emit([2]);
  const result=await h.session.finish();
  assert.equal(result.text,'final');
  // The flush chunk from stop() ([99]) is pushed before streamFinish.
  assert.deepEqual(h.log,['start','push1:1','push2:2','push3:99','finish7']);
  assert.deepEqual(h.drafts,['d1','d2','d3']);
  assert.equal(h.session.state,'idle');
});

test('cancel stops capture, cancels the engine session and drops late drafts',async()=>{
  const h=harness({pushDelay:()=>30});
  await h.session.start();h.emit([1]);
  await new Promise(r=>setTimeout(r,5));
  h.session.cancel();
  await new Promise(r=>setTimeout(r,60));
  assert.deepEqual(h.drafts,[]);
  assert.ok(h.log.includes('cancel7'));assert.equal(h.stopped(),1);
  assert.deepEqual(await h.session.finish(),{cancelled:true});
});

test('a push failure reports once and aborts the session',async()=>{
  const h=harness({pushResult:()=>({success:false,error:'engine down'})});
  await h.session.start();h.emit([1]);h.emit([2]);
  await new Promise(r=>setTimeout(r,20));
  assert.deepEqual(h.errors,['engine down']);
  assert.equal(h.session.state,'idle');
  assert.ok(h.log.includes('cancel7'));
});

test('start failure is reported and leaves the session idle',async()=>{
  const h=harness({start:{success:false,error:'no model'}});
  assert.equal(await h.session.start(),false);
  assert.deepEqual(h.errors,['no model']);
  assert.equal(h.session.state,'idle');
});

test('cancel while the microphone is opening releases both the capture and the engine session',async()=>{
  const log=[];let release;
  const api={streamStart:async()=>({success:true,session:3}),streamPush:async()=>({success:true}),streamFinish:async()=>({}),streamCancel:async id=>{log.push(`cancel${id}`);}};
  const session=new StreamingSession({api,createCapture:()=>new Promise(r=>{release=()=>r({stop:async()=>{log.push('stopped');}});}),onError:()=>{}});
  const started=session.start();
  await new Promise(r=>setTimeout(r,5));
  session.cancel();release();
  assert.equal(await started,false);
  await new Promise(r=>setTimeout(r,5));
  assert.ok(log.includes('stopped'));assert.ok(log.includes('cancel3'));
});

test('starting twice is refused while a session is active',async()=>{
  const h=harness();
  assert.equal(await h.session.start(),true);
  assert.equal(await h.session.start(),false);
});

test('float samples convert to clamped 16-bit PCM',()=>{
  assert.deepEqual(Array.from(floatToInt16(Float32Array.from([0,1,-1,2,-2,0.5]))),[0,32767,-32768,32767,-32768,16383]);
});
