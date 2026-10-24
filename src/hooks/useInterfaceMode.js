import {useEffect,useRef,useState} from 'react';
import {observeInterfaceMode,requestInterfaceMode} from '../desktop/interface-mode.mjs';

export function useInterfaceMode() {
  const api=window.electronAPI;
  const [mode,setMode]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const observer=useRef(null);
  useEffect(()=>{
    observer.current=observeInterfaceMode(api,value=>{setMode(value);setError('');},reason=>setError(reason.message||String(reason)));
    return ()=>observer.current?.dispose();
  },[api]);
  const changeMode=async(next,phase='idle')=>{
    setSaving(true);setError('');
    try {await requestInterfaceMode(api,next,phase);await observer.current?.refresh();return true;}
    catch(reason){setError(reason.message||String(reason));return false;}
    finally{setSaving(false);}
  };
  return {mode,error,saving,changeMode};
}
