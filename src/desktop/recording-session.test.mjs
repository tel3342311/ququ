import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordingSession } from './recording-session.mjs';

function harness(getMedia) {
  const state={stopped:0,recorders:[],completed:[],recording:[],errors:[]};
  const stream={getTracks:()=>[{stop:()=>state.stopped++}]};
  const session=new RecordingSession({
    getUserMedia:getMedia||(async()=>stream),
    createRecorder:()=>{const recorder={state:'inactive',mimeType:'audio/mp4',start(){this.state='recording';},stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.());}};state.recorders.push(recorder);return recorder;},
    onRecording:value=>state.recording.push(value), onStopped:(blob)=>state.completed.push(blob),onError:error=>state.errors.push(error),
  });
  return {state,stream,session};
}
test('cancelled recording stops tracks without transcription callback', async()=>{
  const {state,session}=harness();await session.start();session.cancel();await Promise.resolve();
  assert.equal(state.stopped,1);assert.equal(state.completed.length,0);assert.equal(state.recording.at(-1),false);
});
test('cancelling pending microphone permission never starts a recorder later',async()=>{
  let resolve;const {state,session,stream}=harness(()=>new Promise(r=>resolve=r));const starting=session.start();session.cancel();resolve(stream);
  assert.equal(await starting,false);assert.equal(state.recorders.length,0);assert.equal(state.stopped,1);
});
test('hold release during permission request cancels the pending start',async()=>{
  let resolve;const {state,session,stream}=harness(()=>new Promise(r=>resolve=r));const starting=session.start();session.stop();resolve(stream);
  await starting;assert.equal(state.recorders.length,0);assert.equal(state.completed.length,0);
});
test('duplicate starts share one microphone request',async()=>{
  let resolve,calls=0;const {session,stream}=harness(()=>{calls++;return new Promise(r=>resolve=r)});const starting=session.start();
  assert.equal(await session.start(),false);resolve(stream);assert.equal(await starting,true);assert.equal(calls,1);session.cancel();
});
test('normal stop produces one blob using the selected recorder MIME type',async()=>{
  const {session,state}=harness();await session.start();state.recorders[0].ondataavailable({data:new Blob(['audio'])});session.stop();await Promise.resolve();
  assert.equal(state.completed.length,1);assert.equal(state.completed[0].type,'audio/mp4');assert.equal(await state.completed[0].text(),'audio');
});
