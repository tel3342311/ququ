const modifier = /^(Control|Shift|Alt|Meta)(Left|Right)$/;

export const CUSTOM_HOTKEY_PRESET = 'custom';

const MACOS_HOTKEY_PRESETS = Object.freeze([
  Object.freeze({ key: 'ControlRight', label: '右 Control' }),
  Object.freeze({ key: 'AltRight', label: '右 Option' }),
  Object.freeze({ key: 'MetaRight', label: '右 Command' }),
  Object.freeze({ key: 'F5', label: 'F5' }),
  Object.freeze({ key: 'F6', label: 'F6' }),
  Object.freeze({ key: 'F7', label: 'F7' }),
  Object.freeze({ key: 'F8', label: 'F8' }),
  Object.freeze({ key: 'Control+Shift+Space', label: 'Control + Shift + 空白鍵' }),
  Object.freeze({ key: 'Alt+Space', label: 'Option + 空白鍵' }),
]);

const WINDOWS_HOTKEY_PRESETS = Object.freeze([
  Object.freeze({ key: 'ControlRight', label: '右 Ctrl' }),
  Object.freeze({ key: 'AltRight', label: '右 Alt' }),
  Object.freeze({ key: 'F8', label: 'F8' }),
  Object.freeze({ key: 'Control+Shift+Space', label: 'Ctrl + Shift + 空白鍵' }),
  Object.freeze({ key: 'Alt+Space', label: 'Alt + 空白鍵' }),
]);

export function normalizeHotkeyPlatform(platform) {
  const raw = platform ?? (
    globalThis.navigator?.userAgentData?.platform
    || globalThis.navigator?.platform
    || globalThis.navigator?.userAgent
    || globalThis.process?.platform
    || ''
  );
  const value = String(raw).toLowerCase();
  if (value.includes('mac') || value.includes('darwin')) return 'macos';
  return 'windows';
}

export function hotkeyPresetsForPlatform(platform) {
  return normalizeHotkeyPlatform(platform) === 'macos'
    ? MACOS_HOTKEY_PRESETS
    : WINDOWS_HOTKEY_PRESETS;
}

export function presetValueForKey(key, platform) {
  if (typeof key !== 'string' || !key) return CUSTOM_HOTKEY_PRESET;
  const presets = hotkeyPresetsForPlatform(platform);
  return presets.some(preset => preset.key === key) ? key : CUSTOM_HOTKEY_PRESET;
}

export function keyForPresetValue(presetValue, currentKey = '', platform) {
  if (presetValue === CUSTOM_HOTKEY_PRESET) return currentKey;
  const presets = hotkeyPresetsForPlatform(platform);
  const matched = presets.find(preset => preset.key === presetValue);
  return matched ? matched.key : currentKey;
}

export function customPresetLabel(key, platform) {
  if (typeof key === 'string' && key && presetValueForKey(key, platform) === CUSTOM_HOTKEY_PRESET) {
    return `自訂（${key}）`;
  }
  return '自訂';
}

export function createHotkeyCapture() {
  let candidate = null;
  let finished = false;
  return {
    keydown(event) {
      if (finished || event.repeat) return null;
      if (event.code === 'Escape') { finished = true; return 'cancel'; }
      if (modifier.test(event.code)) { candidate = event.code; return null; }
      const code = event.code || '';
      const key = /^Key[A-Z]$/.test(code) ? code.slice(3)
        : /^Digit[0-9]$/.test(code) ? code.slice(5)
        : /^(F([1-9]|1[0-9]|2[0-4])|Space|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right))$/.test(code) ? code.replace('Arrow', '') : null;
      if (!key) return null;
      const parts = [];
      if (event.ctrlKey) parts.push('Control');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');
      if (event.metaKey) parts.push('Super');
      if (!parts.length && !/^F\d+$/.test(key)) { candidate = null; return null; }
      finished = true;
      return [...parts, key].join('+');
    },
    keyup(event) {
      if (!finished && candidate === event.code) { finished = true; return candidate; }
      return null;
    },
  };
}

const PERMISSION_LABELS = Object.freeze({
  'input-monitoring': '輸入監控',
  accessibility: '輔助使用',
});

/**
 * Explains, in Traditional Chinese, why a hotkey will not fire while another app is
 * focused and which macOS permission to grant. Returns null when nothing needs attention.
 */
export function hotkeyPermissionGuidance(status, key) {
  if (!status) return null;
  const permissions = status.permissions || {};
  const missing = [];
  if (permissions.required && permissions.inputMonitoring === false) missing.push('input-monitoring');
  if (permissions.required && permissions.accessibility === false) missing.push('accessibility');
  const notice = typeof status.notice === 'string' ? status.notice : '';
  const needsHook = modifier.test(typeof key === 'string' ? key : '');
  if (!notice && !(needsHook && missing.length)) return null;
  const names = missing.map(item => `「${PERMISSION_LABELS[item]}」`).join('與');
  const message = notice || `此快速鍵需要${names}權限，才能在其他應用程式中使用。請在「系統設定 > 隱私權與安全性」中允許「蛐蛐」，然後重新開啟蛐蛐。`;
  return {
    message,
    actions: missing.map(item => ({ pane: item, label: `開啟${PERMISSION_LABELS[item]}設定` })),
    canReapply: Boolean(status.desired?.key),
  };
}
