import test from 'node:test';
import assert from 'node:assert/strict';
import {finishRecording} from './recorded-dictation.mjs';
test('audio preparation failure emits one numeric error report and never transcribes',async()=>{
 let time=0;const metrics=[];await assert.rejects(finishRecording({},new Blob(),{now:()=>time++,onMetrics:m=>metrics.push(m),prepareAudio:async()=>{throw Error('decode failed')}}),/decode failed/);
 assert.equal(metrics.length,1);assert.equal(metrics[0].outcome,3);assert.ok(metrics[0].audioPreparationMs>0);assert.equal(metrics[0].asrMs,0);
});
test('cancel during audio preparation emits cancellation without ASR',async()=>{
 let valid=true;const metrics=[];const result=await finishRecording({},new Blob(),{isCurrent:()=>valid,onMetrics:m=>metrics.push(m),prepareAudio:async()=>{valid=false;return new Uint8Array([1]);}});
 assert.equal(result.cancelled,true);assert.equal(metrics.length,1);assert.equal(metrics[0].outcome,4);
});
test('shared report includes preparation and reports an ASR error exactly once',async()=>{
 let time=0;const metrics=[];await assert.rejects(finishRecording({transcribeAudio:async()=>{throw Error('ASR failed')}},new Blob(),{now:()=>time++,onMetrics:m=>metrics.push(m),prepareAudio:async()=>new Uint8Array([1])}),/ASR failed/);
 assert.equal(metrics.length,1);assert.ok(metrics[0].asrMs>0);assert.ok(metrics[0].audioPreparationMs>0);
});
