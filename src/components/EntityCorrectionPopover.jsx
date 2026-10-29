import React, { useState, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';

export default function EntityCorrectionPopover({
  isOpen,
  word,
  initialReplacement = '',
  onSave,
  onClose,
  isSaving = false,
}) {
  const [currentWord, setCurrentWord] = useState('');
  const [replacement, setReplacement] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setCurrentWord(word || '');
      setReplacement(initialReplacement || '');
      // Focus replacement input on open
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, word, initialReplacement]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleanWord = currentWord.trim();
    if (!cleanWord) return;
    onSave({
      word: cleanWord,
      replacement: replacement.trim(),
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-label="建立專有詞彙"
      className="mt-3 p-3 rounded-lg border border-primary/30 bg-card text-card-foreground shadow-md transition-all duration-150 select-none"
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-center justify-between text-xs font-semibold mb-2">
        <span className="text-foreground">
          {initialReplacement ? `編輯詞組「${word}」` : `為「${word || '新詞彙'}」建立專有詞彙`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xs p-1 rounded"
          title="關閉"
          aria-label="關閉"
        >
          ✕
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={currentWord}
            onChange={(e) => setCurrentWord(e.target.value)}
            placeholder="辨識詞彙"
            aria-label="辨識詞彙"
            className="flex-1 px-2.5 py-1.5 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-muted-foreground font-bold text-xs select-none">➔</span>
          <input
            ref={inputRef}
            type="text"
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="正確寫法 (選填)"
            aria-label="正確寫法 (選填)"
            className="flex-1 px-2.5 py-1.5 text-xs rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-muted-foreground">
            {replacement ? '聽寫時將自動替換為正確寫法' : '留空則作為純辨識專有詞彙'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-2.5 py-1 text-xs rounded text-muted-foreground hover:bg-secondary transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSaving || !currentWord.trim()}
              className="px-3 py-1 text-xs font-medium rounded bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {replacement ? '儲存替換' : '儲存詞彙'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
