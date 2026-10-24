export function recordingOptions(recorder) {
  const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => recorder.isTypeSupported(type));
  return mimeType ? { mimeType } : {};
}

export function encodeWav(audio) {
  const channels=audio.numberOfChannels, dataSize=audio.length*channels*2;
  const buffer=new ArrayBuffer(44+dataSize),view=new DataView(buffer);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+dataSize,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);
  view.setUint32(24,audio.sampleRate,true);view.setUint32(28,audio.sampleRate*channels*2,true);
  view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,dataSize,true);
  const samples=Array.from({length:channels},(_,channel)=>audio.getChannelData(channel));
  let offset=44;
  for(let frame=0;frame<audio.length;frame++)for(let channel=0;channel<channels;channel++){
    const value=Math.max(-1,Math.min(1,samples[channel][frame]));
    view.setInt16(offset,value<0?value*32768:value*32767,true);offset+=2;
  }
  return buffer;
}

export async function wavBytesFromBlob(blob) {
  const Context=window.AudioContext||window.webkitAudioContext;
  const context=new Context({sampleRate:16000});
  try {return new Uint8Array(encodeWav(await context.decodeAudioData(await blob.arrayBuffer())));}
  finally {await context.close();}
}
