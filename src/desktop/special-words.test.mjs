import test from 'node:test';
import assert from 'node:assert/strict';
import { applySpecialWords, isPair } from './special-words.mjs';
import { createDesktopAPI } from './bridge.mjs';

test('applySpecialWords leaves text unchanged when no special words provided', () => {
  const sentence = '我昨天跟王小明討論了邊緣裝置上的部署。';
  assert.equal(applySpecialWords(sentence, []), sentence);
  assert.equal(applySpecialWords(sentence, null), sentence);
  assert.equal(applySpecialWords('', [{ word: '王小明' }]), '');
});

test('applySpecialWords ignores plain words (no replacement) which are for recognition bias', () => {
  const sentence = '我昨天跟王小明討論了邊緣裝置上的部署。';
  const words = [
    { word: '王小明' },
    { word: '邊緣裝置', replacement: '' },
    { word: '部署', replacement: '   ' },
  ];
  assert.equal(applySpecialWords(sentence, words), sentence);
});

test('applySpecialWords replaces heard text with correct spelling for pairs', () => {
  const sentence = '我昨天跟王小明討論了庫伯內提斯在邊緣裝置上的部署。';
  const words = [
    { word: '王小明' }, // plain word
    { word: '庫伯內提斯', replacement: 'Kubernetes' }, // pair
  ];
  assert.equal(
    applySpecialWords(sentence, words),
    '我昨天跟王小明討論了Kubernetes在邊緣裝置上的部署。'
  );
});

test('applySpecialWords replaces multiple occurrences in the sentence', () => {
  const sentence = '蛐蛐是一個聽寫工具，蛐蛐很好用。';
  const words = [{ word: '蛐蛐', replacement: 'ququ' }];
  assert.equal(applySpecialWords(sentence, words), 'ququ是一個聽寫工具，ququ很好用。');
});

test('applySpecialWords sorts longer phrases first to prevent partial replacement bugs', () => {
  const sentence = '我們使用的是庫伯內提斯架構。';
  const words = [
    { word: '庫伯', replacement: 'Kube' },
    { word: '庫伯內提斯', replacement: 'Kubernetes' },
  ];
  // Longer match '庫伯內提斯' must be replaced first, not '庫伯' -> 'Kube內提斯'
  assert.equal(applySpecialWords(sentence, words), '我們使用的是Kubernetes架構。');
});

test('applySpecialWords matches Traditional transcript using normalized match_word of a Simplified saved word', () => {
  const entries = [{ word: '软件', match_word: '軟體', replacement: 'software' }];
  assert.equal(applySpecialWords('這個軟體很好', entries), '這個software很好');
});

test('isPair correctly identifies pairs vs plain words', () => {
  assert.equal(isPair({ word: '王小明' }), false);
  assert.equal(isPair({ word: '王小明', replacement: '' }), false);
  assert.equal(isPair({ word: '王小明', replacement: '   ' }), false);
  assert.equal(isPair({ word: '蛐蛐', replacement: 'ququ' }), true);
});

test('bridge maps special words and transcription update commands', async () => {
  const calls = [];
  const api = createDesktopAPI({
    invoke: async (cmd, payload) => {
      calls.push([cmd, payload]);
      if (payload.action === 'get-special-words') {
        return [{ id: 1, word: '庫伯內提斯', replacement: 'Kubernetes' }];
      }
      return { success: true };
    },
    listen() {},
  });

  const list = await api.getSpecialWords();
  assert.equal(list.length, 1);
  assert.equal(list[0].word, '庫伯內提斯');

  await api.saveSpecialWord('王小明');
  await api.saveSpecialWord({ word: '蛐蛐', replacement: 'ququ' });
  await api.deleteSpecialWord(1);
  await api.updateTranscription(42, '更新後的文字');

  assert.deepEqual(calls, [
    ['desktop_command', { action: 'get-special-words', args: [] }],
    ['desktop_command', { action: 'save-special-word', args: ['王小明'] }],
    ['desktop_command', { action: 'save-special-word', args: [{ word: '蛐蛐', replacement: 'ququ' }] }],
    ['desktop_command', { action: 'delete-special-word', args: [1] }],
    ['desktop_command', { action: 'update-transcription', args: [42, '更新後的文字'] }],
  ]);
});
