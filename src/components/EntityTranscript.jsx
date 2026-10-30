import React, { useMemo, useState, useEffect } from 'react';
import { tokenizeTranscript, getTokenRange } from '../desktop/entity-tokenizer.mjs';

export default function EntityTranscript({
  text,
  specialWords = [],
  onWordClick,
  paragraphRef,
  isPopoverOpen,
}) {
  const tokens = useMemo(() => {
    return tokenizeTranscript(text, specialWords);
  }, [text, specialWords]);

  const [anchorIndex, setAnchorIndex] = useState(null);
  const [selectedRange, setSelectedRange] = useState(null); // [startIndex, endIndex]

  useEffect(() => {
    if (isPopoverOpen === false) {
      setAnchorIndex(null);
      setSelectedRange(null);
    }
  }, [isPopoverOpen]);

  useEffect(() => {
    setAnchorIndex(null);
    setSelectedRange(null);
  }, [text]);

  const handleTokenClick = (idx, e) => {
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
    }

    const token = tokens[idx];
    if (!token) return;

    const isShift = Boolean(e.shiftKey);

    if (isShift && anchorIndex !== null) {
      const range = getTokenRange(tokens, anchorIndex, idx);
      setSelectedRange([range.startIndex, range.endIndex]);

      const isSingle = range.startIndex === range.endIndex;
      if (isSingle && token.isSpecial) {
        onWordClick?.({
          word: token.special?.word || token.text,
          replacement: token.special?.replacement || '',
          isSpecial: true,
          specialId: token.special?.id,
          startIndex: range.startIndex,
          endIndex: range.endIndex,
        });
      } else {
        onWordClick?.({
          word: range.text,
          replacement: '',
          isSpecial: false,
          startIndex: range.startIndex,
          endIndex: range.endIndex,
        });
      }
    } else {
      setAnchorIndex(idx);
      setSelectedRange([idx, idx]);

      if (token.isSpecial) {
        onWordClick?.({
          word: token.special?.word || token.text,
          replacement: token.special?.replacement || '',
          isSpecial: true,
          specialId: token.special?.id,
          startIndex: idx,
          endIndex: idx,
        });
      } else {
        onWordClick?.({
          word: token.text,
          replacement: '',
          isSpecial: false,
          startIndex: idx,
          endIndex: idx,
        });
      }
    }
  };

  return (
    <p
      ref={paragraphRef}
      className="whitespace-pre-wrap break-words mt-2 leading-relaxed select-text"
    >
      {tokens.map((token, idx) => {
        const isSelected =
          selectedRange !== null && idx >= selectedRange[0] && idx <= selectedRange[1];

        if (token.isSpecial) {
          const isPair = Boolean(token.special?.replacement);
          return (
            <span
              key={idx}
              data-token-index={idx}
              data-selected={isSelected ? 'true' : undefined}
              onClick={(e) => handleTokenClick(idx, e)}
              className={`entity-token-special ${
                isPair ? 'entity-token-pair' : 'entity-token-plain'
              } ${isSelected ? 'entity-token-selected' : ''}`}
              title={
                isPair
                  ? `替換詞組：${token.special.word} ➔ ${token.special.replacement}（點擊編輯）`
                  : `專有詞彙：${token.special?.word || token.text}（點擊編輯）`
              }
            >
              {token.text}
            </span>
          );
        }

        if (token.isWordLike) {
          return (
            <span
              key={idx}
              data-token-index={idx}
              data-selected={isSelected ? 'true' : undefined}
              onClick={(e) => handleTokenClick(idx, e)}
              className={`entity-token ${isSelected ? 'entity-token-selected' : ''}`}
              title={`點擊將「${token.text}」加入專有詞彙`}
            >
              {token.text}
            </span>
          );
        }

        return (
          <span
            key={idx}
            data-token-index={idx}
            data-selected={isSelected ? 'true' : undefined}
            className={isSelected ? 'entity-token-selected' : undefined}
            onClick={(e) => {
              if (e.shiftKey && anchorIndex !== null) {
                handleTokenClick(idx, e);
              }
            }}
          >
            {token.text}
          </span>
        );
      })}
    </p>
  );
}
