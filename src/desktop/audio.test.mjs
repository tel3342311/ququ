import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingOptions, encodeWav } from './audio.mjs';
test('prefers supported Opus recording and falls back to Safari MP4', () => {
  assert.deepEqual(recordingOptions({isTypeSupported:type=>type==='audio/webm;codecs=opus'}),{mimeType:'audio/webm;codecs=opus'});
  assert.deepEqual(recordingOptions({isTypeSupported:type=>type==='audio/mp4'}),{mimeType:'audio/mp4'});
});
test('lets the WebView choose when none of the preferred encodings are supported', () => {
  assert.deepEqual(recordingOptions({isTypeSupported:()=>false}),{});
});
test('WAV encoder preserves sample rate and signed PCM extrema',()=>{
  const bytes=encodeWav({length:3,sampleRate:16000,numberOfChannels:1,getChannelData:()=>new Float32Array([-1,0,1])});
  const view=new DataView(bytes);
  assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint32(40,true),6);
  assert.equal(view.getInt16(44,true),-32768);assert.equal(view.getInt16(46,true),0);assert.equal(view.getInt16(48,true),32767);
});
