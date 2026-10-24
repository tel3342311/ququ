import test from 'node:test';
import assert from 'node:assert/strict';
import { createHotkeyCapture } from './hotkey.mjs';
import { createDesktopAPI } from './bridge.mjs';

test('captures physical single modifiers on release, without capturing repeats', () => {
  const capture = createHotkeyCapture();
  assert.equal(capture.keydown({code:'ControlRight', ctrlKey:true}), null);
  assert.equal(capture.keydown({code:'ControlRight', ctrlKey:true, repeat:true}), null);
  assert.equal(capture.keyup({code:'ControlRight'}), 'ControlRight');
});
test('captures canonical chords and does not replace them on modifier release', () => {
  const capture = createHotkeyCapture();
  capture.keydown({code:'ControlLeft', ctrlKey:true});
  assert.equal(capture.keydown({code:'Space', ctrlKey:true, shiftKey:true}), 'Control+Shift+Space');
  assert.equal(capture.keyup({code:'ControlLeft'}), null);
});
test('captures F keys, cancels Escape and refuses unidentified keys', () => {
  const capture = createHotkeyCapture();
  assert.equal(capture.keydown({code:'F8'}), 'F8');
  assert.equal(createHotkeyCapture().keydown({code:'Escape'}), 'cancel');
  assert.equal(createHotkeyCapture().keydown({code:'Unidentified'}), null);
  assert.equal(createHotkeyCapture().keydown({code:'KeyA'}), null);
  assert.equal(createHotkeyCapture().keydown({code:'Space'}), null);
});
test('hotkey configuration and dictation errors use explicit native commands', async () => {
  const calls = [];
  const api = createDesktopAPI({invoke:async (_, args) => calls.push(args), listen:async () => () => {}});
  await api.getHotkeyConfig();
  await api.setHotkeyConfig({key:'ControlRight',mode:'hold'});
  await api.beginHotkeyCapture();
  await api.endHotkeyCapture();
  await api.reportDictationError('No microphone');
  assert.deepEqual(calls.map(call => call.action), ['get-hotkey-config','set-hotkey-config','begin-hotkey-capture','end-hotkey-capture','report-dictation-error']);
  assert.deepEqual(calls[1].args, [{key:'ControlRight',mode:'hold'}]);
  let received;
  const events = createDesktopAPI({invoke(){}, listen:async (name, callback) => { received=name; callback({payload:'failed'}); return () => {}; }});
  events.onDictationError((_, data) => assert.equal(data, 'failed'));
  assert.equal(received, 'dictation-error');
});
