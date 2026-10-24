import test from 'node:test';
import assert from 'node:assert/strict';
import { RecordingSession } from './recording-session.mjs';

test('tray toggle starts and stops recording session', async () => {
  let recordingState = false;
  let phase = 'idle';
  const calls = [];

  const session = new RecordingSession({
    getUserMedia: async () => ({
      getTracks: () => [{ stop: () => calls.push('track-stop') }],
    }),
    createRecorder: () => ({
      state: 'inactive',
      mimeType: 'audio/webm',
      start() {
        this.state = 'recording';
      },
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => this.onstop?.());
      },
    }),
    onRecording: value => {
      recordingState = value;
      phase = value ? 'recording' : 'idle';
      calls.push(['recording', value]);
    },
    onStopped: async blob => {
      calls.push(['stopped', blob.size]);
    },
    onError: err => calls.push(['error', err]),
  });

  // Tray toggle when idle -> starts
  assert.equal(phase, 'idle');
  const started = await session.start();
  assert.equal(started, true);
  assert.equal(phase, 'recording');
  assert.equal(recordingState, true);

  // Tray toggle when recording -> stops
  session.stop();
  await Promise.resolve();
  assert.equal(phase, 'idle');
  assert.equal(recordingState, false);
  assert.equal(calls.filter(c => Array.isArray(c) && c[0] === 'stopped').length, 1);
  assert.equal(calls.includes('track-stop'), true);
});

test('tray cancel discards recording without triggering onStopped', async () => {
  let recordingState = false;
  let phase = 'idle';
  const calls = [];

  const session = new RecordingSession({
    getUserMedia: async () => ({
      getTracks: () => [{ stop: () => calls.push('track-stop') }],
    }),
    createRecorder: () => ({
      state: 'inactive',
      mimeType: 'audio/webm',
      start() {
        this.state = 'recording';
      },
      stop() {
        this.state = 'inactive';
        queueMicrotask(() => this.onstop?.());
      },
    }),
    onRecording: value => {
      recordingState = value;
      phase = value ? 'recording' : 'idle';
      calls.push(['recording', value]);
    },
    onStopped: async blob => {
      calls.push(['stopped', blob.size]);
    },
    onError: err => calls.push(['error', err]),
  });

  await session.start();
  assert.equal(recordingState, true);

  // Tray cancel during recording
  session.cancel();
  await Promise.resolve();
  assert.equal(recordingState, false);
  // onStopped must NOT have been called!
  assert.equal(calls.some(c => Array.isArray(c) && c[0] === 'stopped'), false);
  assert.equal(calls.includes('track-stop'), true);
});
