import React, { useLayoutEffect, useRef } from 'react';

export default function CompactDictation({ isRecording, draft = '', phase = 'idle' }) {
  const bodyRef = useRef(null);

  useLayoutEffect(() => {
    document.documentElement.classList.add('compact-dictation');
    return () => document.documentElement.classList.remove('compact-dictation');
  }, []);

  useLayoutEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [draft]);

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
      <div className="indicator-body" ref={bodyRef}>
        <span className="indicator-text">
          {hasDraft ? draft : (isRecording ? '正在聆聽語音…' : '待命')}
          {isRecording && <span className="indicator-cursor" aria-hidden="true" />}
        </span>
      </div>
      <span className="recording-label sr-only">{isRecording ? 'Recording...' : 'Idle'}</span>
    </div>
  );
}
