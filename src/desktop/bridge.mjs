// A bounded allowlist keeps the existing React API while Rust replaces Electron.
const commands = {
  hideWindow: 'hide-window', showWindow: 'show-window', minimizeWindow: 'minimize-window', closeWindow: 'close-window',
  startRecording: 'start-recording', stopRecording: 'stop-recording',
  checkFunASRStatus: 'check-funasr-status', restartFunasrServer: 'restart-funasr-server', installFunASR: 'install-funasr',
  checkModelFiles: 'check-model-files', getDownloadProgress: 'get-download-progress', downloadModels: 'download-models',
  processText: 'process-text', checkAIStatus: 'check-ai-status',
  pasteText: 'paste-text', copyText: 'copy-text', readClipboard: 'read-clipboard', writeClipboard: 'write-clipboard',
  saveTranscription: 'save-transcription', getTranscriptions: 'get-transcriptions', deleteTranscription: 'delete-transcription',
  clearAllTranscriptions: 'clear-all-transcriptions', exportTranscriptions: 'export-transcriptions',
  getSettings: 'get-settings', getAllSettings: 'get-all-settings', getSetting: 'get-setting', setSetting: 'set-setting',
  saveSetting: 'save-setting', resetSettings: 'reset-settings', importSettings: 'import-settings', exportSettings: 'export-settings',
  registerHotkey: 'register-hotkey', unregisterHotkey: 'unregister-hotkey', getCurrentHotkey: 'get-current-hotkey',
  getHotkeyConfig: 'get-hotkey-config', setHotkeyConfig: 'set-hotkey-config',
  beginHotkeyCapture: 'begin-hotkey-capture', endHotkeyCapture: 'end-hotkey-capture',
  reportDictationError: 'report-dictation-error',
  invalidateDictation: 'invalidate-dictation',
  getInterfaceMode: 'get-interface-mode', setInterfaceMode: 'set-interface-mode',
  setDictationPhase: 'set-dictation-phase',
  registerF2Hotkey: 'register-f2-hotkey', unregisterF2Hotkey: 'unregister-f2-hotkey',
  setRecordingState: 'set-recording-state', getRecordingState: 'get-recording-state',
  getSystemInfo: 'get-system-info', checkPermissions: 'check-permissions', requestPermissions: 'request-permissions',
  testAccessibilityPermission: 'test-accessibility-permission', openSystemPermissions: 'open-system-permissions',
  getAppVersion: 'get-app-version', checkForUpdates: 'check-for-updates', log: 'log', getDebugInfo: 'get-debug-info',
  openControlPanel: 'open-control-panel', closeControlPanel: 'close-control-panel',
  openHistoryWindow: 'open-history-window', closeHistoryWindow: 'close-history-window', hideHistoryWindow: 'hide-history-window',
  openSettingsWindow: 'open-settings-window', closeSettingsWindow: 'close-settings-window', hideSettingsWindow: 'hide-settings-window',
  getAvailableModels: 'get-available-models', getCurrentModel: 'get-current-model', switchModel: 'switch-model',
  getPerformanceStats: 'get-performance-stats', clearPerformanceStats: 'clear-performance-stats',
};
const events = {
  onToggleDictation: 'toggle-dictation', onF2DoubleClick: 'f2-double-click', onHotkeyTriggered: 'hotkey-triggered',
  onTranscriptionUpdate: 'transcription-update', onProcessingUpdate: 'processing-update', onError: 'error',
  onSettingsUpdate: 'settings-update', onModelDownloadProgress: 'model-download-progress',
  onDictationError: 'dictation-error', onInterfaceModeChanged: 'interface-mode-changed',
};

export function createDesktopAPI({ invoke, listen, onListenerError = () => {} }) {
  const api = { runtime: 'tauri' };
  for (const [method, action] of Object.entries(commands)) {
    api[method] = (...args) => invoke('desktop_command', { action, args });
  }
  api.transcribeAudio = (audio, options = {}) => {
    const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio)
      : ArrayBuffer.isView(audio) ? new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength) : audio;
    return invoke('desktop_command', { action: 'transcribe-audio', args: [Array.from(bytes), options] });
  };
  for (const [method, event] of Object.entries(events)) {
    api[method] = callback => {
      let disposed = false;
      let release;
      const ready=Promise.resolve(listen(event, message => { if (!disposed) callback({}, message.payload); }))
        .then(unlisten => { if (disposed) unlisten(); else release = unlisten; });
      ready.catch(error => { if (!disposed) onListenerError(error); });
      const dispose=() => { if (disposed) return; disposed = true; release?.(); };
      dispose.ready=ready;
      return dispose;
    };
  }
  return api;
}
