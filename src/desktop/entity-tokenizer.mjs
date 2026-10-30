/**
 * Tokenizes transcript text into interactive word tokens and matched special word entities.
 *
 * @param {string} text - The transcript text.
 * @param {Array<{id?: number|string, word: string, replacement?: string}>} specialWords - Stored special words.
 * @returns {Array<{text: string, isSpecial: boolean, special?: {id?: number|string, word: string, replacement?: string}, isWordLike: boolean}>}
 */
export function tokenizeTranscript(text, specialWords = []) {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Filter and normalize special words
  const validSpecials = (Array.isArray(specialWords) ? specialWords : [])
    .filter(item => item && typeof item.word === 'string' && item.word.trim().length > 0)
    .map(item => ({
      id: item.id,
      word: item.word.trim(),
      replacement: typeof item.replacement === 'string' ? item.replacement.trim() : '',
    }));

  // Build target matches for exact entities (both replacement and original word)
  // Sort longest first to avoid partial substring mismatches
  const matchTargets = [];
  for (const s of validSpecials) {
    if (s.replacement) {
      matchTargets.push({ text: s.replacement, special: s });
    }
    matchTargets.push({ text: s.word, special: s });
  }
  matchTargets.sort((a, b) => b.text.length - a.text.length);

  // Split text by special words
  let segments = [{ text, special: null }];
  for (const target of matchTargets) {
    const next = [];
    for (const seg of segments) {
      if (seg.special) {
        next.push(seg);
        continue;
      }
      let remaining = seg.text;
      while (remaining.length > 0) {
        const idx = remaining.indexOf(target.text);
        if (idx === -1) {
          next.push({ text: remaining, special: null });
          break;
        }
        if (idx > 0) {
          next.push({ text: remaining.slice(0, idx), special: null });
        }
        next.push({ text: target.text, special: target.special });
        remaining = remaining.slice(idx + target.text.length);
      }
    }
    segments = next;
  }

  // Segment non-special pieces into clickable words
  const hasIntlSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
  const segmenter = hasIntlSegmenter ? new Intl.Segmenter('zh-TW', { granularity: 'word' }) : null;

  const tokens = [];
  for (const seg of segments) {
    if (seg.special) {
      tokens.push({
        text: seg.text,
        isSpecial: true,
        special: seg.special,
        isWordLike: true,
      });
    } else if (segmenter) {
      for (const item of segmenter.segment(seg.text)) {
        tokens.push({
          text: item.segment,
          isSpecial: false,
          isWordLike: Boolean(item.isWordLike),
        });
      }
    } else {
      // Fallback regex word splitting
      const parts = seg.text.split(/([a-zA-Z0-9_\u4e00-\u9fa5]+|[^\s\w\u4e00-\u9fa5]+|\s+)/).filter(Boolean);
      for (const part of parts) {
        const isWord = /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(part);
        tokens.push({
          text: part,
          isSpecial: false,
          isWordLike: isWord,
        });
      }
    }
  }

  return tokens;
}

/**
 * Resolves a contiguous token range between anchor and target indices (order-independent)
 * and returns the slice of tokens along with the joined text.
 *
 * @param {Array<{text: string, isSpecial?: boolean, special?: object, isWordLike?: boolean}>} tokens
 * @param {number|null|undefined} anchorIndex
 * @param {number|null|undefined} targetIndex
 * @returns {{ startIndex: number, endIndex: number, tokens: Array<object>, text: string }}
 */
export function getTokenRange(tokens, anchorIndex, targetIndex) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return { startIndex: -1, endIndex: -1, tokens: [], text: '' };
  }

  const hasAnchor = typeof anchorIndex === 'number' && !Number.isNaN(anchorIndex);
  const hasTarget = typeof targetIndex === 'number' && !Number.isNaN(targetIndex);

  if (!hasAnchor && !hasTarget) {
    return { startIndex: -1, endIndex: -1, tokens: [], text: '' };
  }

  const rawStart = hasAnchor ? anchorIndex : targetIndex;
  const rawEnd = hasTarget ? targetIndex : anchorIndex;

  const startIndex = Math.max(0, Math.min(rawStart, rawEnd));
  const endIndex = Math.min(tokens.length - 1, Math.max(rawStart, rawEnd));

  if (startIndex > endIndex || startIndex >= tokens.length || endIndex < 0) {
    return { startIndex: -1, endIndex: -1, tokens: [], text: '' };
  }

  const selectedTokens = tokens.slice(startIndex, endIndex + 1);
  const text = selectedTokens.map(t => (t && typeof t.text === 'string' ? t.text : '')).join('');

  return {
    startIndex,
    endIndex,
    tokens: selectedTokens,
    text,
  };
}

/**
 * Returns the joined text of tokens between anchor and target indices.
 *
 * @param {Array<{text: string}>} tokens
 * @param {number|null|undefined} anchorIndex
 * @param {number|null|undefined} targetIndex
 * @returns {string}
 */
export function joinTokenRange(tokens, anchorIndex, targetIndex) {
  return getTokenRange(tokens, anchorIndex, targetIndex).text;
}
