import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeTranscript, getTokenRange } from './entity-tokenizer.mjs';

test('tokenizeTranscript returns empty array for empty or non-string input', () => {
  assert.deepEqual(tokenizeTranscript(''), []);
  assert.deepEqual(tokenizeTranscript(null), []);
  assert.deepEqual(tokenizeTranscript(undefined), []);
});

test('tokenizeTranscript splits plain sentence into word and non-word tokens', () => {
  const sentence = '邊緣運算很實用。';
  const tokens = tokenizeTranscript(sentence, []);
  assert.ok(tokens.length > 0);
  const words = tokens.filter(t => t.isWordLike).map(t => t.text);
  assert.ok(words.includes('邊緣'));
  assert.ok(words.includes('運算'));
  const punct = tokens.find(t => t.text === '。');
  assert.ok(punct);
  assert.equal(punct.isWordLike, false);
  assert.equal(punct.isSpecial, false);
});

test('tokenizeTranscript marks matched plain special words as entity tokens', () => {
  const sentence = '我昨天跟王小明討論了專案。';
  const specialWords = [{ id: 1, word: '王小明' }];
  const tokens = tokenizeTranscript(sentence, specialWords);
  const entity = tokens.find(t => t.isSpecial);
  assert.ok(entity);
  assert.equal(entity.text, '王小明');
  assert.equal(entity.special.id, 1);
  assert.equal(entity.special.word, '王小明');
});

test('tokenizeTranscript marks replaced words from pairs as entity tokens', () => {
  const sentence = '架構使用Kubernetes在邊緣部署。';
  const specialWords = [{ id: 2, word: '庫伯內提斯', replacement: 'Kubernetes' }];
  const tokens = tokenizeTranscript(sentence, specialWords);
  const entity = tokens.find(t => t.isSpecial);
  assert.ok(entity);
  assert.equal(entity.text, 'Kubernetes');
  assert.equal(entity.special.word, '庫伯內提斯');
  assert.equal(entity.special.replacement, 'Kubernetes');
});

test('tokenizeTranscript prioritizes longer matches first', () => {
  const sentence = '我們使用的是庫伯內提斯系統。';
  const specialWords = [
    { id: 1, word: '庫伯', replacement: 'Kube' },
    { id: 2, word: '庫伯內提斯', replacement: 'Kubernetes' },
  ];
  const tokens = tokenizeTranscript(sentence, specialWords);
  const entity = tokens.find(t => t.isSpecial);
  assert.ok(entity);
  assert.equal(entity.text, '庫伯內提斯');
  assert.equal(entity.special.id, 2);
});

test('getTokenRange returns empty result on invalid inputs', () => {
  assert.deepEqual(getTokenRange([], 0, 1), { startIndex: -1, endIndex: -1, tokens: [], text: '' });
  assert.deepEqual(getTokenRange(null, 0, 1), { startIndex: -1, endIndex: -1, tokens: [], text: '' });
  assert.deepEqual(getTokenRange([{ text: 'A' }], null, null), { startIndex: -1, endIndex: -1, tokens: [], text: '' });
  assert.deepEqual(getTokenRange([{ text: 'A' }], 5, 8), { startIndex: -1, endIndex: -1, tokens: [], text: '' });
});

test('getTokenRange selects contiguous range of adjacent words', () => {
  const tokens = tokenizeTranscript('邊緣運算很實用。', []);
  const edgeIdx = tokens.findIndex(t => t.text === '邊緣');
  const computeIdx = tokens.findIndex(t => t.text === '運算');
  assert.ok(edgeIdx !== -1 && computeIdx !== -1);

  const range = getTokenRange(tokens, edgeIdx, computeIdx);
  assert.equal(range.startIndex, edgeIdx);
  assert.equal(range.endIndex, computeIdx);
  assert.equal(range.text, '邊緣運算');
});

test('getTokenRange is order-independent (reverse anchor and target)', () => {
  const tokens = tokenizeTranscript('邊緣運算很實用。', []);
  const edgeIdx = tokens.findIndex(t => t.text === '邊緣');
  const computeIdx = tokens.findIndex(t => t.text === '運算');

  const range = getTokenRange(tokens, computeIdx, edgeIdx);
  assert.equal(range.startIndex, edgeIdx);
  assert.equal(range.endIndex, computeIdx);
  assert.equal(range.text, '邊緣運算');
});

test('getTokenRange includes whitespace and punctuation between anchor and target', () => {
  const tokens = tokenizeTranscript('Hello, world test', []);
  const helloIdx = tokens.findIndex(t => t.text === 'Hello');
  const worldIdx = tokens.findIndex(t => t.text === 'world');
  assert.ok(helloIdx !== -1 && worldIdx !== -1);

  const range = getTokenRange(tokens, helloIdx, worldIdx);
  assert.equal(range.startIndex, helloIdx);
  assert.equal(range.endIndex, worldIdx);
  // Must include the comma and space in between
  assert.equal(range.text, 'Hello, world');
});

test('getTokenRange handles single token anchor', () => {
  const tokens = tokenizeTranscript('測試單一詞彙', []);
  const range = getTokenRange(tokens, 0, 0);
  assert.equal(range.startIndex, 0);
  assert.equal(range.endIndex, 0);
  assert.equal(range.tokens.length, 1);
  assert.equal(range.text, tokens[0].text);
});
