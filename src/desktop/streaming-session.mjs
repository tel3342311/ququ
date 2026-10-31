// Drives one streaming utterance: start the engine session, feed microphone
// chunks in order, expose revisable drafts, and return the engine's final result.
// Drafts are replacement snapshots; only finish() returns text to commit.
export class StreamingSession {
  constructor({ api, createCapture, onDraft = () => {}, onError = () => {} }) {
    Object.assign(this, { api, createCapture, onDraft, onError });
    this.generation = 0; this.state = 'idle'; this.id = null; this.capture = null; this.queue = Promise.resolve();
  }
  isCurrent(generation) { return this.generation === generation; }
  get recording() { return this.state === 'recording'; }

  async start() {
    if (this.state !== 'idle') return false;
    const generation = ++this.generation;
    this.state = 'starting'; this.queue = Promise.resolve();
    try {
      const started = await this.api.streamStart();
      if (!started?.success) throw new Error(started?.error || '無法開始串流辨識');
      if (!this.isCurrent(generation)) { this.api.streamCancel(started.session).catch(() => {}); return false; }
      this.id = started.session;
      const capture = await this.createCapture(chunk => this.enqueue(generation, chunk));
      if (!this.isCurrent(generation)) { capture.stop().catch(() => {}); return false; }
      this.capture = capture; this.state = 'recording';
      return true;
    } catch (error) {
      if (this.isCurrent(generation)) { this.abort(); this.onError(error); }
      return false;
    }
  }

  enqueue(generation, chunk) {
    this.queue = this.queue.then(async () => {
      if (!this.isCurrent(generation) || !['recording', 'stopping'].includes(this.state)) return;
      const result = await this.api.streamPush(this.id, chunk);
      if (!this.isCurrent(generation)) return;
      if (!result?.success) throw new Error(result?.error || '串流辨識失敗');
      if (typeof result.draft === 'string') this.onDraft(result.draft);
    }).catch(error => {
      if (this.isCurrent(generation)) { this.abort(); this.onError(error); }
    });
  }

  // Stop the microphone, drain pending audio, and return the final transcription.
  async finish() {
    if (this.state !== 'recording') return { cancelled: true };
    const generation = this.generation, id = this.id;
    this.state = 'stopping';
    await this.capture.stop();
    await this.queue;
    if (!this.isCurrent(generation)) return { cancelled: true };
    try { return await this.api.streamFinish(id); }
    finally { if (this.isCurrent(generation)) this.reset(); }
  }

  cancel() { this.abort(); }

  abort() {
    this.generation++;
    const id = this.id, capture = this.capture;
    this.reset();
    capture?.stop().catch(() => {});
    if (id != null) this.api.streamCancel(id).catch(() => {});
  }

  reset() { this.state = 'idle'; this.id = null; this.capture = null; }
}
