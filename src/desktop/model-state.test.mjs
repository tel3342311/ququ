import test from 'node:test';
import assert from 'node:assert/strict';
import { applyModelProgress, applyModelReady, languagesForEngine } from './model-state.mjs';

test('a different engine download does not disable the active ready engine', () => {
  const previous = {isReady:true,stage:'ready',error:null};
  const result = applyModelProgress(previous,{overall_progress:30});
  assert.equal(result.stage,'ready');
  assert.equal(result.isReady,true);
});
test('failed downloads leave the initial model in a retryable error state', () => {
  const result = applyModelProgress({isReady:false,isDownloading:true},{stage:'error',error:'Network failed'});
  assert.equal(result.stage,'error');assert.equal(result.isDownloading,false);assert.equal(result.error,'Network failed');
});
test('cross-window initialization clears download state and marks files ready', () => {
  const result = applyModelReady({isDownloading:true,error:'old',modelsDownloaded:false},{isReady:true,isLoading:false,progress:100});
  assert.equal(result.stage,'ready');assert.equal(result.isDownloading,false);assert.equal(result.modelsDownloaded,true);assert.equal(result.error,null);
});
test('Paraformer choices exclude languages that native inference rejects', () => {
  assert.deepEqual(languagesForEngine('paraformer'), ['zh','en']);
  assert.ok(languagesForEngine('sense_voice').includes('auto'));
});
