import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopAPI } from './bridge.mjs';

test('maps persisted settings and transcription objects to named native arguments', async () => {
  const calls = [];
  const api = createDesktopAPI({ invoke: async (...args) => calls.push(args), listen() {} });
  await api.setSetting('speech_engine', 'sensevoice');
  await api.saveTranscription({ raw_text: '你好' });
  assert.deepEqual(calls, [
    ['desktop_command', { action: 'set-setting', args: ['speech_engine', 'sensevoice'] }],
    ['desktop_command', { action: 'save-transcription', args: [{ raw_text: '你好' }] }],
  ]);
});

test('converts ArrayBuffer audio to JSON bytes without losing options', async () => {
  let captured;
  const api = createDesktopAPI({ invoke: async (_, args) => { captured = args; }, listen() {} });
  await api.transcribeAudio(new Uint8Array([0, 128, 255]).buffer, { use_punc: false });
  assert.deepEqual(captured.args, [[0, 128, 255], { use_punc: false }]);
});

test('event callbacks retain Electron event and payload convention', async () => {
  let listener;
  let received;
  const api = createDesktopAPI({ invoke() {}, listen: async (_, fn) => { listener = fn; return () => {}; } });
  api.onModelDownloadProgress((...args) => { received = args; });
  await Promise.resolve();
  listener({ payload: { progress: 25 } });
  assert.deepEqual(received, [{}, { progress: 25 }]);
});

test('unmount before asynchronous registration cleans up exactly once and ignores events', async () => {
  let resolve;
  let listener;
  let releases = 0;
  let callbacks = 0;
  const api = createDesktopAPI({ invoke() {}, listen: (_, fn) => { listener = fn; return new Promise(r => { resolve = r; }); } });
  const dispose = api.onHotkeyTriggered(() => callbacks++);
  dispose();
  dispose();
  resolve(() => releases++);
  await Promise.resolve();
  listener({ payload: true });
  assert.equal(releases, 1);
  assert.equal(callbacks, 0);
});
