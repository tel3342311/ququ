import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeTranscript, getTokenRange } from './entity-tokenizer.mjs';
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

test('classic vocabulary flow: combining two adjacent words into one term renders as single chip', () => {
  const sentence = '邊緣運算架構非常先進。';
  const specialWords = [];

  // Initially, 邊緣 and 運算 are separate word tokens
  let tokens = tokenizeTranscript(sentence, specialWords);
  const edgeIdx = tokens.findIndex(t => t.text === '邊緣');
  const computeIdx = tokens.findIndex(t => t.text === '運算');
  assert.ok(edgeIdx !== -1 && computeIdx !== -1);
  assert.equal(tokens[edgeIdx].isSpecial, false);
  assert.equal(tokens[computeIdx].isSpecial, false);

  // Shift-click second word combines adjacent tokens into one term
  const range = getTokenRange(tokens, edgeIdx, computeIdx);
  assert.equal(range.text, '邊緣運算');

  // Saving stores joined phrase as one special word
  specialWords.push({ id: 1, word: range.text });

  // Tokenizing again renders the joined phrase as a single chip
  tokens = tokenizeTranscript(sentence, specialWords);
  const combinedToken = tokens.find(t => t.text === '邊緣運算');
  assert.ok(combinedToken);
  assert.equal(combinedToken.isSpecial, true);
  assert.equal(combinedToken.special.word, '邊緣運算');

  // A click inside an existing multi-word entry keeps it as one chip
  const insideTokens = tokens.filter(t => t.text === '邊緣' || t.text === '運算');
  assert.equal(insideTokens.length, 0); // No split tokens exist
});

test('classic vocabulary flow: Shift-click across whitespace joins multi-word phrase into one chip', () => {
  const sentence = '我們使用的是 QuQu AI 語音引擎。';
  const specialWords = [];

  let tokens = tokenizeTranscript(sentence, specialWords);
  const ququIdx = tokens.findIndex(t => t.text === 'QuQu');
  const aiIdx = tokens.findIndex(t => t.text === 'AI');
  assert.ok(ququIdx !== -1 && aiIdx !== -1);

  // Range includes whitespace token between QuQu and AI
  const range = getTokenRange(tokens, ququIdx, aiIdx);
  assert.equal(range.text, 'QuQu AI');

  // Save joined phrase
  specialWords.push({ id: 2, word: range.text, replacement: '蛐蛐 AI' });

  // If replaced in sentence
  const updatedSentence = applySpecialWords(sentence, specialWords);
  assert.equal(updatedSentence, '我們使用的是 蛐蛐 AI 語音引擎。');

  tokens = tokenizeTranscript(updatedSentence, specialWords);
  const chip = tokens.find(t => t.text === '蛐蛐 AI');
  assert.ok(chip);
  assert.equal(chip.isSpecial, true);
  assert.equal(chip.special.replacement, '蛐蛐 AI');
});
