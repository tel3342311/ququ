import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { createDesktopAPI } from './bridge.mjs';
import { followSystemTheme } from './theme.mjs';

followSystemTheme(document.documentElement, window.matchMedia('(prefers-color-scheme: dark)'));

if (window.__TAURI_INTERNALS__ && !window.electronAPI) {
  window.electronAPI = createDesktopAPI({ invoke, listen,
    onListenerError: error => invoke('desktop_command', { action: 'log', args: ['error', `Event registration failed: ${error.message}`] }).catch(() => {}),
  });
  // The legacy hook moves window.screenX; WebViews require native window dragging.
  document.addEventListener('mousedown', event => {
    if (event.button === 0 && event.target.closest('.draggable') && !event.target.closest('.non-draggable,button,input,select,textarea,a')) {
      getCurrentWindow().startDragging().catch(() => {});
    }
  });
}
