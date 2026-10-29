import React, { useMemo } from 'react';
import { tokenizeTranscript } from '../desktop/entity-tokenizer.mjs';

export default function EntityTranscript({
  text,
  specialWords = [],
  onWordClick,
  paragraphRef,
}) {
  const tokens = useMemo(() => {
    return tokenizeTranscript(text, specialWords);
  }, [text, specialWords]);

  return (
    <p
      ref={paragraphRef}
      className="whitespace-pre-wrap break-words mt-2 leading-relaxed select-text"
    >
      {tokens.map((token, idx) => {
        if (token.isSpecial) {
          const isPair = Boolean(token.special?.replacement);
          return (
            <span
              key={idx}
              onClick={(e) => {
                e.stopPropagation();
                onWordClick?.({
                  word: token.special?.word || token.text,
                  replacement: token.special?.replacement || '',
                  isSpecial: true,
                  specialId: token.special?.id,
                });
              }}
              className={`entity-token-special ${
                isPair ? 'entity-token-pair' : 'entity-token-plain'
              }`}
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
              onClick={(e) => {
                e.stopPropagation();
                onWordClick?.({
                  word: token.text,
                  replacement: '',
                  isSpecial: false,
                });
              }}
              className="entity-token"
              title={`點擊將「${token.text}」加入專有詞彙`}
            >
              {token.text}
            </span>
          );
        }

        return <span key={idx}>{token.text}</span>;
      })}
    </p>
  );
}
