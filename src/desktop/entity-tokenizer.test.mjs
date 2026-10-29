import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeTranscript } from './entity-tokenizer.mjs';

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
