import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'sonner';

export default function SpecialWordBubble({
  targetRef,
  targetSelector,
  onSentenceUpdate,
  api = window.electronAPI,
}) {
  const [bubble, setBubble] = useState({
    visible: false,
    selectedText: '',
    targetElement: null,
    x: 0,
    y: 0,
  });
  const [replacement, setReplacement] = useState('');
  const bubbleRef = useRef(null);
  const inputRef = useRef(null);

  const hide = useCallback(() => {
    setBubble(prev => (prev.visible ? { ...prev, visible: false, selectedText: '', targetElement: null } : prev));
    setReplacement('');
  }, []);

  const handleSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return;
    }
    const text = selection.toString().trim();
    if (!text) return;

    const range = selection.getRangeAt(0);
    const anchorNode = selection.anchorNode;
    const targetElement = anchorNode?.nodeType === Node.TEXT_NODE ? anchorNode.parentElement : anchorNode;

    let matchedElement = null;
    if (targetRef?.current && targetRef.current.contains(targetElement)) {
      matchedElement = targetRef.current;
    } else if (targetSelector) {
      matchedElement = targetElement?.closest(targetSelector);
    }

    if (!matchedElement) return;

    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return;

    // Calculate position
    const popWidth = 280;
    const left = Math.max(8, Math.min(window.innerWidth - popWidth - 8, rect.left + rect.width / 2 - popWidth / 2));
    const top = rect.top >= 52 ? rect.top - 46 : rect.bottom + 8;

    setBubble({
      visible: true,
      selectedText: text,
      targetElement: matchedElement,
      x: left,
      y: top,
    });
  }, [targetRef, targetSelector]);

  // Listen for mouseup on document
  useEffect(() => {
    const onMouseUp = (e) => {
      // If clicking inside the bubble, do not reposition or close
      if (bubbleRef.current && bubbleRef.current.contains(e.target)) {
        return;
      }
      setTimeout(handleSelection, 10);
    };

    const onMouseDown = (e) => {
      if (bubbleRef.current && bubbleRef.current.contains(e.target)) {
        return;
      }
      // If clicking outside bubble and outside matched elements, hide
      let isInsideTarget = false;
      if (targetRef?.current && targetRef.current.contains(e.target)) {
        isInsideTarget = true;
      } else if (targetSelector && e.target.closest(targetSelector)) {
        isInsideTarget = true;
      }
      if (!isInsideTarget) {
        hide();
      }
    };

    const onSelectionChange = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.toString().trim()) {
        // Only hide if the input is not currently focused
        if (document.activeElement !== inputRef.current) {
          hide();
        }
      }
    };

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('selectionchange', onSelectionChange);

    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [handleSelection, hide, targetRef, targetSelector]);

  const handleSave = async (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    const word = bubble.selectedText.trim();
    if (!word) {
      hide();
      return;
    }

    const cleanReplacement = replacement.trim();
    const targetElement = bubble.targetElement;

    try {
      if (api?.saveSpecialWord) {
        await api.saveSpecialWord({
          word,
          replacement: cleanReplacement || undefined,
        });
      }

      if (cleanReplacement) {
        toast.success(`已儲存：${word} → ${cleanReplacement}`);
        if (onSentenceUpdate) {
          onSentenceUpdate(word, cleanReplacement, targetElement);
        }
      } else {
        toast.success(`已加入專有詞彙：${word}`);
      }
    } catch (err) {
      console.error('Failed to save special word:', err);
      toast.error(err?.message || '儲存專有詞彙失敗');
    } finally {
      hide();
      window.getSelection()?.removeAllRanges();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hide();
      window.getSelection()?.removeAllRanges();
    }
  };

  if (!bubble.visible) return null;

  return (
    <div
      ref={bubbleRef}
      role="dialog"
      aria-label="加入專有詞彙"
      className="fixed z-50 flex items-center gap-1.5 p-1.5 rounded-lg shadow-xl text-xs bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 border border-neutral-700/50 dark:border-neutral-300"
      style={{
        left: `${bubble.x}px`,
        top: `${bubble.y}px`,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        placeholder="正確寫法 (選填)"
        aria-label="正確寫法 (選填)"
        value={replacement}
        onChange={e => setReplacement(e.target.value)}
        onKeyDown={handleKeyDown}
        autoFocus
        className="px-2 py-1 text-xs rounded bg-neutral-800 dark:bg-neutral-200 text-neutral-100 dark:text-neutral-900 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 border border-neutral-700 dark:border-neutral-300 focus:outline-none focus:ring-1 focus:ring-blue-500 w-32"
      />
      <button
        type="button"
        onClick={handleSave}
        className="px-2.5 py-1 text-xs font-medium rounded bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer whitespace-nowrap"
      >
        ＋ 加入專有詞彙
      </button>
    </div>
  );
}
