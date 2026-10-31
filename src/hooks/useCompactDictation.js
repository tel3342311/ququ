import {useEffect,useRef,useState} from 'react';
import {useModelStatus} from './useModelStatus';
import {RecordingSession} from '../desktop/recording-session.mjs';
import {recordingOptions} from '../desktop/audio.mjs';
import {finishRecording} from '../desktop/recorded-dictation.mjs';
import {finishDictation} from '../desktop/dictation.mjs';
import {StreamingSession} from '../desktop/streaming-session.mjs';
import {createMicrophoneCapture} from '../desktop/pcm.mjs';

export function useCompactDictation() {
  const api=window.electronAPI;
  const model=useModelStatus(),modelRef=useRef(model);modelRef.current=model;
  const [phase,setPhaseState]=useState('idle');
  const [result,setResult]=useState(null),[error,setError]=useState('');
  const [draft,setDraft]=useState(''),[streamReady,setStreamReady]=useState(false);
  const streaming=useRef(null),streamActive=useRef(false),deciding=useRef(false);
  const phaseRef=useRef('idle'),session=useRef(null),intentRef=useRef(0),phaseQueue=useRef(Promise.resolve(true)),stoppedAt=useRef(null);
  const report=message=>{setError(message);api.reportDictationError(message).catch(()=>{});};
  const setPhase=value=>{
    phaseRef.current=value;setPhaseState(value);
    phaseQueue.current=phaseQueue.current.then(()=>api.setDictationPhase(value)).then(()=>true).catch(reason=>{report(reason.message||String(reason));return false;});
    return phaseQueue.current;
  };
  if(!session.current)session.current=new RecordingSession({
    getUserMedia:()=>navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}}),
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
  if(!streaming.current)streaming.current=new StreamingSession({api,createCapture:createMicrophoneCapture,
    onDraft:setDraft,
    onError:reason=>{streamActive.current=false;intentRef.current++;setDraft('');api.setRecordingState(false).catch(()=>{});setPhase('idle');report(reason.message||String(reason));}});
  // Streaming is used only when switched on and its model package is installed.
  const streamAvailable=async()=>{
    try {
      if(typeof api.streamStatus!=='function')return false;
      if(!await api.getSetting('streaming_enabled',false))return false;
      return Boolean((await api.streamStatus())?.installed);
    } catch {return false;}
  };
  const refreshStreamReady=()=>{streamAvailable().then(setStreamReady).catch(()=>setStreamReady(false));};
  const finishStreaming=async()=>{
    const intent=intentRef.current,startedAt=stoppedAt.current??performance.now();stoppedAt.current=null;
    const isCurrent=()=>intentRef.current===intent&&streamActive.current;
    try {
      const finished=await finishDictation(api,null,{isCurrent,startedAt,
        recognize:()=>streaming.current.finish(),
        onMetrics:metrics=>{api.log('info',`dictation-performance ${JSON.stringify(metrics)}`).catch(()=>{});},
        onPhase:value=>{if(isCurrent())setPhase(value);}});
      if(!isCurrent())return;
      if(finished.text)setResult(finished);
      if(finished.warning)report(finished.warning);
    } catch(reason) {if(isCurrent())report(reason.message||String(reason));}
    finally {if(isCurrent()){streamActive.current=false;setDraft('');setPhase('idle');refreshStreamReady();}}
  };
  const dispatchRef=useRef(null);
  dispatchRef.current=async action=>{
    const current=session.current;
    if(action==='cancel'){intentRef.current++;current.cancel();streaming.current.cancel();streamActive.current=false;setDraft('');api.invalidateDictation().catch(error=>report(String(error)));setPhase('idle');return;}
    if(action==='toggle')action=['recording','starting'].includes(phaseRef.current)?'stop':'start';
    if(action==='stop'){
      if(current.pending||phaseRef.current==='starting'){intentRef.current++;current.cancel();streaming.current.cancel();streamActive.current=false;setPhase('idle');}
      else if(streamActive.current&&streaming.current.recording){
        stoppedAt.current=performance.now();setPhase('processing');
        api.setRecordingState(false).catch(error=>report(String(error)));
        finishStreaming();
      }
      else if(current.recorder?.state==='recording'){stoppedAt.current=performance.now();setPhase('processing');current.stop();}
      return;
    }
    if(action!=='start'||phaseRef.current!=='idle'||deciding.current)return;
    deciding.current=true;
    let useStream;
    try {useStream=await streamAvailable();} finally {deciding.current=false;}
    if(phaseRef.current!=='idle')return;
    if(!useStream&&!modelRef.current.isReady){report(modelRef.current.error||'語音模型尚未就緒，請從系統匣開啟設定。');return;}
    setError('');setDraft('');stoppedAt.current=null;
    const intent=++intentRef.current;
    const published=await setPhase('starting');
    if(intent!==intentRef.current)return;
    if(!published){setPhase('idle');return;}
    if(useStream){
      streamActive.current=true;
      const started=await streaming.current.start();
      if(intent!==intentRef.current)return;
      if(started){setPhase('recording');api.setRecordingState(true).catch(error=>report(String(error)));}
      else {streamActive.current=false;if(phaseRef.current==='starting')setPhase('idle');}
      return;
    }
    const generation=current.generation+1;
    current.start().then(started=>{if(!started&&current.isCurrent(generation)&&phaseRef.current==='starting')setPhase('idle');});
  };
  useEffect(()=>{
    const dispose=api.onHotkeyTriggered((_,data)=>dispatchRef.current(data?.action||'toggle'));
    return ()=>{dispose();intentRef.current++;session.current.cancel();streaming.current.cancel();};
  },[api]);
  useEffect(()=>{
    refreshStreamReady();
    const dispose=api.onSettingsUpdate?.(()=>refreshStreamReady());
    return ()=>{if(typeof dispose==='function')dispose();};
  },[api]);
  return {
    phase,
    draft,
    canRecord: model.isReady||streamReady,
    isRecording: phase === 'recording',
    result,
    setResult,
    updateResultText: updater => {
      setResult(prev => {
        if (!prev) return prev;
        const newText = typeof updater === 'function' ? updater(prev.text) : updater;
        return { ...prev, text: newText };
      });
    },
    error,
    model,
    dispatch: action => dispatchRef.current(action),
  };
}
