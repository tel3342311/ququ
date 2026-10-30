/**
 * Vocabulary (專有詞彙) portable file format import/export utilities.
 * Supports versioned JSON (v1) and plain text (heard => correct / bare word).
 */

export function serializeVocabulary(words = [], now = new Date()) {
  const list = Array.isArray(words) ? words : [];
  const entries = list.map(item => ({
    word: String(item.word || '').trim(),
    replacement: item.replacement && String(item.replacement).trim() ? String(item.replacement).trim() : null,
    created_at: item.created_at || (now instanceof Date ? now.toISOString() : new Date().toISOString()),
  })).filter(entry => entry.word.length > 0);

  return JSON.stringify({
    version: 1,
    exported_at: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    words: entries,
  }, null, 2);
}

export function parseVocabulary(content) {
  if (typeof content !== 'string') {
    throw new Error('詞彙內容必須為字串');
  }

  const trimmed = content.trimStart();
  const entries = [];
  let invalid = 0;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`無效的 JSON 格式: ${err.message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('詞彙檔案格式錯誤：根層級必須為物件');
    }

    const { version, words } = parsed;
    if (typeof version !== 'number' || !Number.isInteger(version)) {
      throw new Error('詞彙檔案格式錯誤：缺少版本號');
    }
    if (version > 1) {
      throw new Error(`不支援的檔案版本：版本 ${version}（目前僅支援版本 1）`);
    }
    if (version < 1) {
      throw new Error('無效的檔案版本：版本號必須大於或等於 1');
    }
    if (!Array.isArray(words)) {
      throw new Error('詞彙檔案格式錯誤：words 欄位必須為陣列');
    }

    for (const item of words) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        invalid++;
        continue;
      }
      const rawWord = item.word;
      if (typeof rawWord !== 'string' || !rawWord.trim()) {
        invalid++;
        continue;
      }
      let replacement = null;
      if (typeof item.replacement === 'string') {
        const rTrim = item.replacement.trim();
        replacement = rTrim || null;
      } else if (item.replacement === null || item.replacement === undefined) {
        replacement = null;
      } else {
        invalid++;
        continue;
      }

      entries.push({
        word: rawWord.trim(),
        replacement,
        created_at: typeof item.created_at === 'string' && item.created_at.trim() ? item.created_at.trim() : null,
      });
    }
  } else {
    // Plain text format
    const lines = content.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      if (line.includes('=>')) {
        const parts = line.split('=>');
        const heard = parts[0].trim();
        const correct = parts.slice(1).join('=>').trim();
        if (!heard) {
          invalid++;
          continue;
        }
        entries.push({
          word: heard,
          replacement: correct || null,
          created_at: null,
        });
      } else {
        entries.push({
          word: line,
          replacement: null,
          created_at: null,
        });
      }
    }
  }

  return { entries, invalid };
}

export function mergeVocabulary(existingWords = [], newEntries = [], initialInvalid = 0) {
  const existingSet = new Set();
  for (const item of existingWords || []) {
    if (item && item.word) {
      existingSet.add(String(item.word).trim());
    }
  }

  let added = 0;
  let skipped = 0;
  const toAdd = [];
  const seenInBatch = new Set();

  for (const entry of newEntries) {
    const word = entry.word;
    if (existingSet.has(word) || seenInBatch.has(word)) {
      skipped++;
    } else {
      seenInBatch.add(word);
      toAdd.push(entry);
      added++;
    }
  }

  return {
    toAdd,
    summary: {
      added,
      skipped,
      invalid: initialInvalid,
    },
  };
}
