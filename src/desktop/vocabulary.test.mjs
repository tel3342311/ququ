import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeVocabulary, parseVocabulary, mergeVocabulary } from './vocabulary.mjs';
import { createDesktopAPI } from './bridge.mjs';

test('serializeVocabulary: empty list produces valid JSON with version 1', () => {
  const jsonStr = serializeVocabulary([]);
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.version, 1);
  assert.equal(typeof parsed.exported_at, 'string');
  assert.deepEqual(parsed.words, []);
});

test('serializeVocabulary and parseVocabulary: round-trip preserves plain and pair words', () => {
  const words = [
    { word: '王小明', replacement: null, created_at: '2026-10-30T10:00:00Z' },
    { word: '庫伯內提斯', replacement: 'Kubernetes', created_at: '2026-10-30T10:05:00Z' },
  ];
  const exported = serializeVocabulary(words);
  const { entries, invalid } = parseVocabulary(exported);

  assert.equal(invalid, 0);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].word, '王小明');
  assert.equal(entries[0].replacement, null);
  assert.equal(entries[1].word, '庫伯內提斯');
  assert.equal(entries[1].replacement, 'Kubernetes');

  // Merging into empty DB adds both
  const merged = mergeVocabulary([], entries, invalid);
  assert.equal(merged.summary.added, 2);
  assert.equal(merged.summary.skipped, 0);
  assert.equal(merged.summary.invalid, 0);
});

test('parseVocabulary: accepts plain text with pairs, bare words, comments and blanks', () => {
  const text = `
# 專有詞彙註解
庫伯內提斯 => Kubernetes
蛐蛐

  AI   =>   人工智慧  
# 這是另一個註解
=> 沒有聽到的詞
重複詞彙
`;
  const { entries, invalid } = parseVocabulary(text);
  assert.equal(invalid, 1); // "=> 沒有聽到的詞" has empty heard
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(e => [e.word, e.replacement]), [
    ['庫伯內提斯', 'Kubernetes'],
    ['蛐蛐', null],
    ['AI', '人工智慧'],
    ['重複詞彙', null],
  ]);
});

test('mergeVocabulary: de-duplication against existing entries (existing wins, conflict skipped)', () => {
  const existing = [
    { word: '庫伯內提斯', replacement: 'K8s' },
  ];
  const newEntries = [
    { word: '庫伯內提斯', replacement: 'Kubernetes' }, // conflict -> existing wins, skipped
    { word: '王小明', replacement: 'Xiao-Ming' }, // added
    { word: '王小明', replacement: 'Other' }, // duplicate in batch -> skipped
  ];
  const { toAdd, summary } = mergeVocabulary(existing, newEntries, 0);

  assert.equal(summary.added, 1);
  assert.equal(summary.skipped, 2);
  assert.equal(summary.invalid, 0);
  assert.equal(toAdd.length, 1);
  assert.equal(toAdd[0].word, '王小明');
  assert.equal(toAdd[0].replacement, 'Xiao-Ming');
});

test('parseVocabulary: rejects malformed JSON and unsupported versions', () => {
  // Invalid JSON syntax
  assert.throws(() => parseVocabulary('{ invalid json '), /無效的 JSON 格式/);

  // Root is array
  assert.throws(() => parseVocabulary('[{"word":"test"}]'), /根層級必須為物件/);

  // Missing version
  assert.throws(() => parseVocabulary('{"words":[]}'), /缺少版本號/);

  // Unsupported version > 1
  assert.throws(() => parseVocabulary('{"version":2,"words":[]}'), /不支援的檔案版本：版本 2/);

  // Version < 1
  assert.throws(() => parseVocabulary('{"version":0,"words":[]}'), /版本號必須大於或等於 1/);

  // Missing words
  assert.throws(() => parseVocabulary('{"version":1}'), /words 欄位必須為陣列/);

  // Words not array
  assert.throws(() => parseVocabulary('{"version":1,"words":"not array"}'), /words 欄位必須為陣列/);

  // Forward compatibility: unknown fields tolerated; invalid items counted in invalid
  const withUnknown = JSON.stringify({
    version: 1,
    client: 'ququ-macos',
    words: [
      { word: 'Valid', replacement: 'OK', extra: true },
      { not_a_word: 123 },
      { word: '   ' },
      { word: 'BadReplacement', replacement: 12345 },
    ],
  });
  const { entries, invalid } = parseVocabulary(withUnknown);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].word, 'Valid');
  assert.equal(entries[0].replacement, 'OK');
  assert.equal(invalid, 3);
});

test('bridge maps exportSpecialWords and importSpecialWords commands', async () => {
  const calls = [];
  const api = createDesktopAPI({
    invoke: async (cmd, payload) => {
      calls.push([cmd, payload]);
      if (payload.action === 'export-special-words') {
        return { success: true, filePath: '/tmp/words.json' };
      }
      if (payload.action === 'import-special-words') {
        return { success: true, filePath: '/tmp/words.json', summary: { added: 1, skipped: 0, invalid: 0 } };
      }
      return { success: true };
    },
    listen() {},
  });

  const exportResult = await api.exportSpecialWords();
  assert.equal(exportResult.success, true);
  assert.equal(exportResult.filePath, '/tmp/words.json');

  const importResult = await api.importSpecialWords();
  assert.equal(importResult.success, true);
  assert.equal(importResult.summary.added, 1);

  assert.deepEqual(calls, [
    ['desktop_command', { action: 'export-special-words', args: [] }],
    ['desktop_command', { action: 'import-special-words', args: [] }],
  ]);
});
