import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOM_HOTKEY_PRESET,
  createHotkeyCapture,
  customPresetLabel,
  hotkeyPermissionGuidance,
  hotkeyPresetsForPlatform,
  keyForPresetValue,
  normalizeHotkeyPlatform,
  presetValueForKey,
} from './hotkey.mjs';
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

test('derives platform-specific hotkey presets with Traditional Chinese labels and ControlRight first', () => {
  assert.equal(normalizeHotkeyPlatform('macos'), 'macos');
  assert.equal(normalizeHotkeyPlatform('darwin'), 'macos');
  assert.equal(normalizeHotkeyPlatform('MacIntel'), 'macos');
  assert.equal(normalizeHotkeyPlatform('windows'), 'windows');
  assert.equal(normalizeHotkeyPlatform('win32'), 'windows');
  assert.equal(normalizeHotkeyPlatform('Win32'), 'windows');

  const macPresets = hotkeyPresetsForPlatform('macos');
  assert.equal(macPresets[0].key, 'ControlRight');
  assert.deepEqual(macPresets, [
    { key: 'ControlRight', label: '右 Control' },
    { key: 'AltRight', label: '右 Option' },
    { key: 'MetaRight', label: '右 Command' },
    { key: 'F5', label: 'F5' },
    { key: 'F6', label: 'F6' },
    { key: 'F7', label: 'F7' },
    { key: 'F8', label: 'F8' },
    { key: 'Control+Shift+Space', label: 'Control + Shift + 空白鍵' },
    { key: 'Alt+Space', label: 'Option + 空白鍵' },
  ]);

  const winPresets = hotkeyPresetsForPlatform('windows');
  assert.equal(winPresets[0].key, 'ControlRight');
  assert.deepEqual(winPresets, [
    { key: 'ControlRight', label: '右 Ctrl' },
    { key: 'AltRight', label: '右 Alt' },
    { key: 'F8', label: 'F8' },
    { key: 'Control+Shift+Space', label: 'Ctrl + Shift + 空白鍵' },
    { key: 'Alt+Space', label: 'Alt + 空白鍵' },
  ]);
});

test('every preset key matches the canonical output of createHotkeyCapture', () => {
  const captureEvents = {
    ControlRight: [{ type: 'keydown', event: { code: 'ControlRight', ctrlKey: true } }, { type: 'keyup', event: { code: 'ControlRight' } }],
    AltRight: [{ type: 'keydown', event: { code: 'AltRight', altKey: true } }, { type: 'keyup', event: { code: 'AltRight' } }],
    MetaRight: [{ type: 'keydown', event: { code: 'MetaRight', metaKey: true } }, { type: 'keyup', event: { code: 'MetaRight' } }],
    F5: [{ type: 'keydown', event: { code: 'F5' } }],
    F6: [{ type: 'keydown', event: { code: 'F6' } }],
    F7: [{ type: 'keydown', event: { code: 'F7' } }],
    F8: [{ type: 'keydown', event: { code: 'F8' } }],
    'Control+Shift+Space': [{ type: 'keydown', event: { code: 'Space', ctrlKey: true, shiftKey: true } }],
    'Alt+Space': [{ type: 'keydown', event: { code: 'Space', altKey: true } }],
  };

  for (const platform of ['macos', 'windows']) {
    for (const preset of hotkeyPresetsForPlatform(platform)) {
      const sequence = captureEvents[preset.key];
      assert.ok(sequence, `missing capture sequence for preset ${preset.key}`);
      const capture = createHotkeyCapture();
      let captured = null;
      for (const step of sequence) {
        captured = capture[step.type](step.event) ?? captured;
      }
      assert.equal(captured, preset.key, `capture output must match preset key ${preset.key} on ${platform}`);
    }
  }
});

test('maps between preset selection values and config.key including custom captured keys', () => {
  for (const preset of hotkeyPresetsForPlatform('macos')) {
    assert.equal(presetValueForKey(preset.key, 'macos'), preset.key);
    assert.equal(keyForPresetValue(preset.key, 'ControlLeft', 'macos'), preset.key);
    assert.equal(customPresetLabel(preset.key, 'macos'), '自訂');
  }

  for (const preset of hotkeyPresetsForPlatform('windows')) {
    assert.equal(presetValueForKey(preset.key, 'windows'), preset.key);
    assert.equal(keyForPresetValue(preset.key, 'ControlLeft', 'windows'), preset.key);
    assert.equal(customPresetLabel(preset.key, 'windows'), '自訂');
  }

  // Captured keys not in the preset list map to CUSTOM_HOTKEY_PRESET and display in customPresetLabel.
  assert.equal(presetValueForKey('ControlLeft', 'macos'), CUSTOM_HOTKEY_PRESET);
  assert.equal(customPresetLabel('ControlLeft', 'macos'), '自訂（ControlLeft）');
  assert.equal(keyForPresetValue(CUSTOM_HOTKEY_PRESET, 'ControlLeft', 'macos'), 'ControlLeft');

  // Platform-specific presets that are not in another platform's list fall back to custom on that platform.
  assert.equal(presetValueForKey('MetaRight', 'windows'), CUSTOM_HOTKEY_PRESET);
  assert.equal(customPresetLabel('MetaRight', 'windows'), '自訂（MetaRight）');
  assert.equal(keyForPresetValue('MetaRight', 'ControlLeft', 'windows'), 'ControlLeft');
});

test('hotkey status command is exposed to the settings window', async () => {
  const calls = [];
  const api = createDesktopAPI({invoke:async (_, args) => calls.push(args), listen:async () => () => {}});
  await api.getHotkeyStatus();
  await api.openSystemPermissions('input-monitoring');
  assert.deepEqual(calls.map(call => call.action), ['get-hotkey-status', 'open-system-permissions']);
  assert.deepEqual(calls[1].args, ['input-monitoring']);
});

test('explains missing macOS permissions in Traditional Chinese for modifier hotkeys', () => {
  const missingBoth = {permissions:{required:true, accessibility:false, inputMonitoring:false}, notice:null};
  const guidance = hotkeyPermissionGuidance(missingBoth, 'ControlRight');
  assert.match(guidance.message, /輸入監控/);
  assert.match(guidance.message, /輔助使用/);
  assert.match(guidance.message, /系統設定/);
  assert.deepEqual(guidance.actions.map(action => action.pane), ['input-monitoring', 'accessibility']);
  assert.deepEqual(guidance.actions.map(action => action.label), ['開啟輸入監控設定', '開啟輔助使用設定']);

  const onlyInput = hotkeyPermissionGuidance({permissions:{required:true, accessibility:true, inputMonitoring:false}}, 'MetaRight');
  assert.deepEqual(onlyInput.actions.map(action => action.pane), ['input-monitoring']);
  assert.doesNotMatch(onlyInput.message, /輔助使用/);
});

test('permission guidance stays hidden when nothing blocks the hotkey', () => {
  const missing = {permissions:{required:true, accessibility:false, inputMonitoring:false}};
  assert.equal(hotkeyPermissionGuidance(null, 'ControlRight'), null);
  // Chords and function keys use the OS hotkey API, which needs no permission.
  assert.equal(hotkeyPermissionGuidance(missing, 'Control+Shift+Space'), null);
  assert.equal(hotkeyPermissionGuidance(missing, 'F8'), null);
  assert.equal(hotkeyPermissionGuidance({permissions:{required:true, accessibility:true, inputMonitoring:true}}, 'ControlRight'), null);
  assert.equal(hotkeyPermissionGuidance({permissions:{required:false}}, 'ControlRight'), null);
});

test('startup fallback notice is always surfaced with a re-apply option', () => {
  const status = {
    notice: '您儲存的快速鍵目前無法使用，已暫時改用預設快速鍵。',
    permissions:{required:true, accessibility:true, inputMonitoring:false},
    desired:{key:'MetaRight', mode:'toggle'},
  };
  // Even though the active key is the fallback chord, the user must see why.
  const guidance = hotkeyPermissionGuidance(status, 'CommandOrControl+Shift+Space');
  assert.equal(guidance.message, status.notice);
  assert.equal(guidance.canReapply, true);
  assert.deepEqual(guidance.actions.map(action => action.pane), ['input-monitoring']);
});
