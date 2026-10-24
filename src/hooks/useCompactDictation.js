import {useEffect,useRef,useState} from 'react';
import {useModelStatus} from './useModelStatus';
import {RecordingSession} from '../desktop/recording-session.mjs';
import {recordingOptions} from '../desktop/audio.mjs';
import {finishRecording} from '../desktop/recorded-dictation.mjs';

export function useCompactDictation() {
  const api=window.electronAPI;
  const model=useModelStatus(),modelRef=useRef(model);modelRef.current=model;
  const [phase,setPhaseState]=useState('idle');
  const [result,setResult]=useState(null),[error,setError]=useState('');
  const phaseRef=useRef('idle'),session=useRef(null),intentRef=useRef(0),phaseQueue=useRef(Promise.resolve(true)),stoppedAt=useRef(null);
  const report=message=>{setError(message);api.reportDictationError(message).catch(()=>{});};
  const setPhase=value=>{
    phaseRef.current=value;setPhaseState(value);
    phaseQueue.current=phaseQueue.current.then(()=>api.setDictationPhase(value)).then(()=>true).catch(reason=>{report(reason.message||String(reason));return false;});
    return phaseQueue.current;
  };
  if(!session.current)session.current=new RecordingSession({
    getUserMedia:()=>navigator.mediaDevices.getUserMedia({audio:{sampleRate:16000,channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true}}),
    createRecorder:stream=>new MediaRecorder(stream,recordingOptions(MediaRecorder)),
    onRecording:recording=>{
      if(recording)setPhase('recording');
      else if(!['processing','optimizing'].includes(phaseRef.current))setPhase('idle');
      api.setRecordingState(recording).catch(error=>report(String(error)));
    },
    onError:error=>{setPhase('idle');report(error.message||String(error));},
    onStopped:async(blob,generation)=>{
      const startedAt=stoppedAt.current??performance.now();stoppedAt.current=null;
      const isCurrent=()=>session.current.isCurrent(generation);
      if(!isCurrent())return;
      setPhase('processing');
      try {
        const finished=await finishRecording(api,blob,{isCurrent,startedAt,
          onMetrics:metrics=>{api.log('info',`dictation-performance ${JSON.stringify(metrics)}`).catch(()=>{});},
          onPhase:value=>{if(isCurrent())setPhase(value);}});
        if(!isCurrent())return;
        if(finished.text)setResult(finished);
        if(finished.warning)report(finished.warning);
      } catch(error) {if(isCurrent())report(error.message||String(error));}
      finally {if(isCurrent())setPhase('idle');}
    },
  });
  const dispatchRef=useRef(null);
  dispatchRef.current=async action=>{
    const current=session.current;
    if(action==='cancel'){intentRef.current++;current.cancel();api.invalidateDictation().catch(error=>report(String(error)));setPhase('idle');return;}
    if(action==='toggle')action=['recording','starting'].includes(phaseRef.current)?'stop':'start';
    if(action==='stop'){
      if(current.pending||phaseRef.current==='starting'){intentRef.current++;current.cancel();setPhase('idle');}
      else if(current.recorder?.state==='recording'){stoppedAt.current=performance.now();setPhase('processing');current.stop();}
      return;
    }
    if(action!=='start'||phaseRef.current!=='idle')return;
    if(!modelRef.current.isReady){report(modelRef.current.error||'語音模型尚未就緒，請從系統匣開啟設定。');return;}
    setError('');stoppedAt.current=null;
    const intent=++intentRef.current;
    const published=await setPhase('starting');
    if(intent!==intentRef.current)return;
    if(!published){setPhase('idle');return;}
    const generation=current.generation+1;
    current.start().then(started=>{if(!started&&current.isCurrent(generation)&&phaseRef.current==='starting')setPhase('idle');});
  };
  useEffect(()=>{
    const dispose=api.onHotkeyTriggered((_,data)=>dispatchRef.current(data?.action||'toggle'));
    return ()=>{dispose();intentRef.current++;session.current.cancel();};
  },[api]);
  return {phase,isRecording:phase==='recording',result,error,model,dispatch:action=>dispatchRef.current(action)};
}
