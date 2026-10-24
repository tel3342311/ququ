import React,{useLayoutEffect} from 'react';

export default function CompactDictation({isRecording}) {
  useLayoutEffect(()=>{
    document.documentElement.classList.add('compact-dictation');
    return ()=>document.documentElement.classList.remove('compact-dictation');
  },[]);
  return <div className={`recording-indicator${isRecording?' is-recording':''}`} role="status" aria-live="polite">
    <span className="recording-dot" aria-hidden="true" />
    <span className="recording-label">{isRecording?'Recording...':'Idle'}</span>
  </div>;
}
