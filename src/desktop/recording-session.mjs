// Owns microphone resources independently of React render timing.
export class RecordingSession {
  constructor({getUserMedia,createRecorder,onRecording,onStopped,onError}) {
    Object.assign(this,{getUserMedia,createRecorder,onRecording,onStopped,onError});
    this.generation=0;this.pending=false;this.recorder=null;this.stream=null;
  }
  isCurrent(generation) { return this.generation===generation; }
  closeTracks() { this.stream?.getTracks().forEach(track=>track.stop());this.stream=null; }
  async start() {
    if(this.pending||this.recorder?.state==='recording')return false;
    const generation=++this.generation;this.pending=true;
    try {
      const stream=await this.getUserMedia();
      if(!this.isCurrent(generation)){stream.getTracks().forEach(track=>track.stop());return false;}
      this.stream=stream;
      const recorder=this.createRecorder(stream);this.recorder=recorder;const chunks=[];
      recorder.ondataavailable=event=>{if(this.isCurrent(generation)&&event.data.size)chunks.push(event.data);};
      recorder.onstop=()=>{
        if(!this.isCurrent(generation))return;
        this.closeTracks();this.onRecording(false);
        Promise.resolve(this.onStopped(new Blob(chunks,{type:recorder.mimeType}),generation)).catch(error=>{if(this.isCurrent(generation))this.onError(error);});
      };
      recorder.onerror=event=>{
        if(!this.isCurrent(generation))return;
        this.cancel();this.onError(event.error||new Error('麦克风录音失败'));
      };
      recorder.start(250);this.onRecording(true);return true;
    } catch(error) {
      if(this.isCurrent(generation)){this.closeTracks();this.onRecording(false);this.onError(error);}
      return false;
    } finally {if(this.isCurrent(generation))this.pending=false;}
  }
  stop() {
    if(this.pending){this.cancel();return;}
    if(this.recorder?.state==='recording'){this.recorder.stop();this.closeTracks();this.onRecording(false);}
  }
  cancel() {
    this.generation++;this.pending=false;
    if(this.recorder?.state==='recording')this.recorder.stop();
    this.closeTracks();this.onRecording(false);
  }
}
