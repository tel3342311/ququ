import test from 'node:test';
import assert from 'node:assert/strict';
import {createPerformanceReport} from './performance.mjs';
test('phase failure is timed and does not hide the original error',async()=>{
  let time=0,metrics;const report=createPerformanceReport({now:()=>time++,onMetrics:m=>metrics=m});
  await assert.rejects(report.measure('asrMs',async()=>{throw Error('failure')}),/failure/);
  report.finish(3);assert.equal(metrics.asrMs,1);assert.equal(metrics.totalMs,3);
});
test('rejected asynchronous observer is isolated',async()=>{
  const report=createPerformanceReport({onMetrics:async()=>{throw Error('observer')}});
  assert.doesNotThrow(()=>report.finish(1));await new Promise(resolve=>setImmediate(resolve));
});
