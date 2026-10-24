import {wavBytesFromBlob} from './audio.mjs';
import {finishDictation} from './dictation.mjs';
import {createPerformanceReport} from './performance.mjs';

export async function finishRecording(api,blob,{prepareAudio=wavBytesFromBlob,...options}={}) {
  const isCurrent=options.isCurrent||(()=>true);
  const report=createPerformanceReport(options);
  try {
    const bytes=await report.measure('audioPreparationMs',()=>prepareAudio(blob));
    if(!isCurrent()){report.finish(4);return{cancelled:true};}
    return await finishDictation(api,bytes,{...options,report});
  } catch(error) {
    report.finish(isCurrent()?3:4);
    throw error;
  }
}
