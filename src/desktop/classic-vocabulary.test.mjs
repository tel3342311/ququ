import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeTranscript } from './entity-tokenizer.mjs';
import { applySpecialWords, isPair } from './special-words.mjs';

test('tokenizeTranscript correctly tags mixed Chinese and English entities', () => {
  const sentence = '我們將在QuQu和Kubernetes上執行AI優化。';
  const specialWords = [
    { id: 1, word: '蛐蛐', replacement: 'QuQu' },
    { id: 2, word: '庫伯內提斯', replacement: 'Kubernetes' },
    { id: 3, word: 'AI優化' },
  ];
  const tokens = tokenizeTranscript(sentence, specialWords);
  const entities = tokens.filter(t => t.isSpecial);
  assert.equal(entities.length, 3);
  assert.equal(entities[0].text, 'QuQu');
  assert.equal(entities[0].special.word, '蛐蛐');
  assert.equal(entities[1].text, 'Kubernetes');
  assert.equal(entities[1].special.word, '庫伯內提斯');
  assert.equal(entities[2].text, 'AI優化');
  assert.equal(entities[2].special.replacement, '');
});

test('tokenizeTranscript handles punctuation and whitespace gracefully', () => {
  const sentence = '你好，世界！ Hello, world. 123';
  const tokens = tokenizeTranscript(sentence, []);
  assert.ok(tokens.length > 0);
  const wordTokens = tokens.filter(t => t.isWordLike);
  assert.ok(wordTokens.some(t => t.text === '你好'));
  assert.ok(wordTokens.some(t => t.text === '世界'));
  assert.ok(wordTokens.some(t => t.text === 'Hello'));
  assert.ok(wordTokens.some(t => t.text === 'world'));
});

test('classic vocabulary flow: applySpecialWords updates sentence when pair is added', () => {
  let sentence = '我昨天跟王小明討論了庫伯內提斯架構。';
  const specialWords = [{ id: 1, word: '王小明' }];

  // Plain word does not mutate text
  sentence = applySpecialWords(sentence, specialWords);
  assert.equal(sentence, '我昨天跟王小明討論了庫伯內提斯架構。');

  // Add pair: 庫伯內提斯 -> Kubernetes
  specialWords.push({ id: 2, word: '庫伯內提斯', replacement: 'Kubernetes' });
  sentence = applySpecialWords(sentence, specialWords);
  assert.equal(sentence, '我昨天跟王小明討論了Kubernetes架構。');

  // Verify tokenizer reflects the updated entity
  const tokens = tokenizeTranscript(sentence, specialWords);
  const kubeEntity = tokens.find(t => t.text === 'Kubernetes');
  assert.ok(kubeEntity);
  assert.equal(kubeEntity.isSpecial, true);
  assert.equal(kubeEntity.special.word, '庫伯內提斯');
  assert.equal(kubeEntity.special.replacement, 'Kubernetes');
});

test('classic vocabulary flow: deleting a word leaves other entities intact', () => {
  const words = [
    { id: 1, word: '王小明' },
    { id: 2, word: '庫伯內提斯', replacement: 'Kubernetes' },
    { id: 3, word: '邊緣運算' },
  ];
  const filtered = words.filter(w => w.id !== 2);
  assert.equal(filtered.length, 2);
  assert.equal(isPair(filtered[0]), false);
  assert.equal(isPair(filtered[1]), false);
});
