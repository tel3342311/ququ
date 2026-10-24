/**
 * Applies heard-to-correct word replacement pairs to transcribed text.
 * Plain words without replacements are ignored (hotword biasing is handled by speech engine if supported).
 * Longer words are replaced first to prevent partial substrings from conflicting.
 *
 * @param {string} text - The input text from speech recognition or AI optimization.
 * @param {Array<{word: string, replacement?: string}>} specialWords - List of special words or pairs.
 * @returns {string} The text with all replacement pairs applied.
 */
export function applySpecialWords(text, specialWords = []) {
  if (!text || typeof text !== 'string' || !Array.isArray(specialWords) || specialWords.length === 0) {
    return text || '';
  }

  // Filter for valid pairs with non-empty word and non-empty replacement
  const pairs = specialWords
    .filter(item => (
      item &&
      typeof item.word === 'string' &&
      item.word.trim().length > 0 &&
      typeof item.replacement === 'string' &&
      item.replacement.trim().length > 0
    ))
    .map(item => ({
      word: item.word.trim(),
      replacement: item.replacement.trim(),
    }))
    // Sort descending by word length so longer phrases match first
    .sort((a, b) => b.word.length - a.word.length);

  let result = text;
  for (const { word, replacement } of pairs) {
    if (word && word !== replacement) {
      result = result.replaceAll(word, replacement);
    }
  }

  return result;
}

/**
 * Checks if a special word entry is a heard-to-correct pair.
 *
 * @param {{word?: string, replacement?: string}} entry
 * @returns {boolean}
 */
export function isPair(entry) {
  return Boolean(
    entry &&
    typeof entry.replacement === 'string' &&
    entry.replacement.trim().length > 0
  );
}
