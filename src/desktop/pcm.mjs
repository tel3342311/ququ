// 16-bit PCM helpers and the browser microphone capture used by streaming.
export function floatToInt16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    out[i] = value < 0 ? value * 32768 : value * 32767;
  }
  return out;
}

// Runs inside the AudioWorklet thread: batches 128-frame blocks into ~200 ms chunks.
export const WORKLET_SOURCE = `
class QuQuPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 3200; this.buffer = new Float32Array(this.size); this.fill = 0;
    this.port.onmessage = event => { if (event.data === 'flush') { this.emit(); this.port.postMessage({ flushed: true }); } };
  }
  emit() {
    if (!this.fill) return;
    const chunk = this.buffer.slice(0, this.fill); this.fill = 0;
    this.port.postMessage({ chunk }, [chunk.buffer]);
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let offset = 0;
      while (offset < channel.length) {
        const take = Math.min(channel.length - offset, this.size - this.fill);
        this.buffer.set(channel.subarray(offset, offset + take), this.fill);
        this.fill += take; offset += take;
        if (this.fill === this.size) this.emit();
      }
    }
    return true;
  }
}
registerProcessor('ququ-pcm', QuQuPcm);
`;

// Opens the microphone and calls onChunk(Int16Array) at 16 kHz mono.
export async function createMicrophoneCapture(onChunk, {
  getUserMedia = () => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
  AudioContextClass = window.AudioContext || window.webkitAudioContext,
} = {}) {
  const stream = await getUserMedia();
  let context;
  const closeAll = () => { stream.getTracks().forEach(track => track.stop()); };
  try {
    context = new AudioContextClass({ sampleRate: 16000 });
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, 'ququ-pcm');
    let flushed;
    node.port.onmessage = event => {
      if (event.data?.chunk) onChunk(floatToInt16(event.data.chunk));
      if (event.data?.flushed) flushed?.();
    };
    source.connect(node);
    return {
      // Flushes buffered audio through onChunk before resolving.
      async stop() {
        const done = new Promise(resolve => { flushed = resolve; });
        node.port.postMessage('flush');
        await Promise.race([done, new Promise(resolve => setTimeout(resolve, 500))]);
        source.disconnect(); node.disconnect(); closeAll();
        await context.close().catch(() => {});
      },
    };
  } catch (error) {
    closeAll();
    context?.close().catch(() => {});
    throw error;
  }
}
