import React from 'react';
import { BookA } from 'lucide-react';

export default function EntityDock({
  words = [],
  onAddClick,
  onEditWord,
  onDeleteWord,
  activeWord = '',
}) {
  return (
    <div className="mt-2.5 pt-2 border-t border-border/60">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <BookA className="w-3.5 h-3.5 text-primary" />
          <span>專有詞彙</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-primary/15 text-primary font-mono font-medium">
            {words.length}
          </span>
        </div>
        <button
          type="button"
          onClick={onAddClick}
          className="text-[11px] text-primary hover:underline flex items-center gap-0.5 cursor-pointer font-medium"
        >
          ＋ 新增詞彙
        </button>
      </div>

      {words.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-1 text-center">
          尚無專有詞彙。點擊上方文字中的單詞即可快速加入。
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto py-0.5 classic-scroll">
          {words.map((item) => {
            const isPair = Boolean(item.replacement && item.replacement.trim());
            const isActive = activeWord === item.word;

            if (isPair) {
              return (
                <div
                  key={item.id || item.word}
                  onClick={() => onEditWord(item)}
                  className={`entity-chip entity-chip-pair cursor-pointer ${
                    isActive ? 'ring-2 ring-emerald-500' : ''
                  }`}
                  title={`點擊編輯：${item.word} ➔ ${item.replacement}`}
                >
                  <span className="font-medium">{item.word}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold mx-0.5">➔</span>
                  <span className="font-semibold underline decoration-emerald-500/40">
                    {item.replacement}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteWord(item.id, item.word);
                    }}
                    className="entity-chip-delete"
                    aria-label={`刪除 ${item.word}`}
                    title="刪除"
                  >
                    ✕
                  </button>
                </div>
              );
            }

            return (
              <div
                key={item.id || item.word}
                onClick={() => onEditWord(item)}
                className={`entity-chip entity-chip-plain cursor-pointer ${
                  isActive ? 'ring-2 ring-blue-500' : ''
                }`}
                title={`點擊編輯：${item.word}`}
              >
                <span>🏷️</span>
                <span className="font-medium">{item.word}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteWord(item.id, item.word);
                  }}
                  className="entity-chip-delete"
                  aria-label={`刪除 ${item.word}`}
                  title="刪除"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
