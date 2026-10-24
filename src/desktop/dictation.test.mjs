import test from 'node:test';
import assert from 'node:assert/strict';
import { finishDictation } from './dictation.mjs';

function harness(overrides={}) {
  const calls=[];
  const api={transcribeAudio:async()=>({success:true,text:'原始文字。',raw_text:'原始文字',duration:2,language:'zh-CN'}),getSetting:async()=>true,
    processText:async()=>({success:true,text:'最佳化後的文字。'}),saveTranscription:async data=>{calls.push(['save',data]);return {lastInsertRowid:1};},pasteText:async text=>{calls.push(['paste',text]);return {success:true};},copyText:async text=>{calls.push(['copy',text]);return {success:true};},log:async()=>{},...overrides};
  return {api,calls};
}
test('saves raw and processed text once and pastes only the final result',async()=>{
  const {api,calls}=harness();await finishDictation(api,new Uint8Array([1,2]));
  assert.equal(calls.filter(([action])=>action==='save').length,1);assert.equal(calls[0][1].raw_text,'原始文字');assert.equal(calls[0][1].processed_text,'最佳化後的文字。');assert.deepEqual(calls[1],['paste','最佳化後的文字。']);
});
test('AI failure falls back to recognized text and still pastes once',async()=>{
  const {api,calls}=harness({processText:async()=>{throw new Error('offline')}});await finishDictation(api,new Uint8Array([1]));
  assert.equal(calls[0][1].text,'原始文字。');assert.deepEqual(calls[1],['paste','原始文字。']);
});
test('cancelled inference cannot save or paste',async()=>{
  let resolve,valid=true;const {api,calls}=harness({transcribeAudio:()=>new Promise(r=>resolve=r)});
  const pending=finishDictation(api,new Uint8Array([1]),{isCurrent:()=>valid});valid=false;resolve({success:true,text:'取消'});await pending;assert.deepEqual(calls,[]);
});
test('silence does not call AI or create an empty history item',async()=>{
  const {api,calls}=harness({transcribeAudio:async()=>({success:true,text:'  '}),processText:async()=>{throw new Error('must not run')}});const result=await finishDictation(api,new Uint8Array([1]));
  assert.equal(result.empty,true);assert.deepEqual(calls,[]);
});
test('paste failure leaves the saved result in clipboard with a warning',async()=>{
  const {api,calls}=harness({pasteText:async()=>{throw new Error('denied')}});const result=await finishDictation(api,new Uint8Array([1]));
  assert.equal(result.pasted,false);assert.deepEqual(calls.at(-1),['copy','最佳化後的文字。']);assert.ok(result.warning);
});
test('cancellation during a pending paste does not copy a late result',async()=>{
  let reject,entered,valid=true;const reached=new Promise(r=>entered=r);
  const {api,calls}=harness({pasteText:()=>{entered();return new Promise((_,r)=>reject=r)}});
  const pending=finishDictation(api,new Uint8Array([1]),{isCurrent:()=>valid});
  await reached;valid=false;reject(new Error('cancelled'));
  assert.equal((await pending).cancelled,true);assert.equal(calls.some(([name])=>name==='copy'),false);
});

 test('reports numeric phase metrics and raw text without transcript leakage',async()=>{
  const {api}=harness();let tick=10,metrics;
  const result=await finishDictation(api,new Uint8Array([1]),{startedAt:0,now:()=>tick+=10,onMetrics:m=>metrics=m});
  assert.equal(result.rawText,'原始文字');assert.equal(metrics.outcome,1);
  assert.equal(metrics.audioPreparationMs,20);assert.equal(metrics.asrMs,10);assert.equal(metrics.aiMs,10);
  assert.equal(metrics.saveMs,10);assert.equal(metrics.pasteMs,10);assert.ok(metrics.totalMs>=80);
  assert.ok(Object.values(metrics).every(value=>typeof value==='number'&&Number.isFinite(value)));
});
test('reports empty, error and cancellation once even when metrics observer throws',async()=>{
  for(const [overrides,options,expected] of [
    [{transcribeAudio:async()=>({success:true,text:''})},{},2],
    [{transcribeAudio:async()=>{throw Error('secret')}},{},3],
    [{},{isCurrent:()=>false},4]
  ]) {
    let metrics,count=0;const {api}=harness(overrides);
    try {await finishDictation(api,new Uint8Array([1]),{...options,onMetrics:m=>{metrics=m;count++;throw Error('observer')}});}catch(e){assert.equal(e.message,'secret');}
    assert.equal(count,1);assert.equal(metrics.outcome,expected);
  }
});
test('save and clipboard failures report error without duplicating side effects',async()=>{
  for(const overrides of [
    {saveTranscription:async()=>{throw Error('save failed')}},
    {pasteText:async()=>({success:false}),copyText:async()=>({success:false,error:'copy failed'})}
  ]) {
    let metrics;const {api}=harness(overrides);
    await assert.rejects(finishDictation(api,new Uint8Array([1]),{onMetrics:m=>metrics=m}),/failed/);
    assert.equal(metrics.outcome,3);
  }
});
