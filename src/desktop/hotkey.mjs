const modifier = /^(Control|Shift|Alt|Meta)(Left|Right)$/;

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
