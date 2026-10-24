/** Numeric-only metrics: outcome 1 success, 2 empty, 3 error, 4 cancelled. */
export function createPerformanceReport({now=()=>performance.now(),startedAt,onMetrics=()=>{}}={}) {
  const entered=now(),start=Number.isFinite(startedAt)?startedAt:entered;
  const metrics={outcome:3,audioPreparationMs:Math.max(0,entered-start),asrMs:0,aiMs:0,saveMs:0,pasteMs:0,totalMs:0};
  let finished=false;
  return {
    async measure(phase,work) {const before=now();try{return await work();}finally{metrics[phase]+=Math.max(0,now()-before);}},
    finish(outcome) {if(finished)return;finished=true;metrics.outcome=outcome;metrics.totalMs=Math.max(0,now()-start);try{const pending=onMetrics({...metrics});pending?.catch?.(()=>{});}catch{/* Observability must never change dictation behavior. */}}
  };
}
