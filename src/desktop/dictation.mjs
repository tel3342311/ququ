import { createPerformanceReport } from './performance.mjs';
export async function finishDictation(api,audio,{isCurrent=()=>true,onPhase=()=>{},onMetrics,startedAt,now,report:sharedReport}={}) {
  const report=sharedReport||createPerformanceReport({onMetrics,startedAt,now});
  let outcome=3;
  const cancelled=()=>{outcome=4;return {cancelled:true};};
  try {
  onPhase('processing');
  const result=await report.measure('asrMs',()=>api.transcribeAudio(audio));
  if(!isCurrent())return cancelled();
  if(!result?.success)throw new Error(result?.error||'語音辨識失敗');
  const recognized=result.text?.trim()||'';
  if(!recognized){outcome=2;return {empty:true};}
  let finalText=recognized,processedText=null;
  const useAI=await api.getSetting('enable_ai_optimization',true);
  if(!isCurrent())return cancelled();
  if(useAI) {
    onPhase('optimizing');
    try {
      const optimized=await report.measure('aiMs',()=>api.processText(recognized,'optimize'));
      if(optimized?.success&&optimized.text?.trim()){processedText=optimized.text.trim();finalText=processedText;}
    } catch { /* Local recognition remains usable when the optional AI is offline. */ }
  }
  if(!isCurrent())return cancelled();
  await report.measure('saveMs',()=>api.saveTranscription({text:finalText,raw_text:result.raw_text??recognized,processed_text:processedText,
    confidence:result.confidence||0,language:result.language||'zh-CN',duration:result.duration||0,file_size:audio.byteLength??audio.length}));
  if(!isCurrent())return cancelled();
  try {
    const pasted=await report.measure('pasteMs',()=>api.pasteText(finalText));
    if(pasted?.success===false)throw new Error(pasted.error||'無法貼上');
    outcome=1;return {text:finalText,rawText:result.raw_text??recognized,pasted:true};
  } catch {
    if(!isCurrent())return cancelled();
    const copied=await report.measure('pasteMs',()=>api.copyText(finalText));
    if(copied?.success===false)throw new Error(copied.error||'無法複製文字，辨識結果已儲存至歷史記錄。');
    outcome=1;return {text:finalText,rawText:result.raw_text??recognized,pasted:false,warning:'無法自動貼上，文字已儲存並複製到剪貼簿。'};
  }
  } finally {report.finish(outcome);}
}

