import React, { useLayoutEffect } from 'react';

export default function CompactDictation({ isRecording, draft = '', phase = 'idle' }) {
  useLayoutEffect(() => {
    document.documentElement.classList.add('compact-dictation');
    return () => document.documentElement.classList.remove('compact-dictation');
  }, []);

  const hasDraft = Boolean(draft && draft.trim().length > 0);
  const charCount = hasDraft ? draft.trim().length : 0;

  return (
    <div
      className={`recording-indicator${isRecording ? ' is-recording' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="indicator-header">
        <div className="indicator-status">
          <span className="recording-dot" aria-hidden="true" />
          <span className="indicator-title">
            {hasDraft ? '即時辨識' : (isRecording ? '正在錄音…' : '待命')}
          </span>
        </div>
        {hasDraft && (
          <span className="indicator-count" aria-hidden="true">
            {charCount} 字
          </span>
        )}
      </div>
      <div className="indicator-body">
        <span className="indicator-text">
          {hasDraft ? draft : (isRecording ? '正在聆聽語音…' : '待命')}
        </span>
        {isRecording && <span className="indicator-cursor" aria-hidden="true" />}
      </div>
      <span className="recording-label sr-only">{isRecording ? 'Recording...' : 'Idle'}</span>
    </div>
  );
}
