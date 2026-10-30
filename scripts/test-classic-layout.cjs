// Renders the real Classic NativeDictation UI through Vite with a stubbed desktop API
// and asserts the vocabulary dock stays visible while a long result scrolls.
const { chromium } = require('playwright-core');
const { createServer } = require('vite');
const assert = require('node:assert/strict');
const path = require('node:path');

const LONG_TEXT = '我發現我如果稍微講多一點的字的話經典模式下專有詞彙的區塊會被擠到下方，今天我們在討論前端架構遷移，特別是從 Electron 轉換到 Tauri 的過程，需要確認語音識別模型的相容性與熱鍵行為。'.repeat(6);
const WORDS = [{ id: 1, word: 'Electron', replacement: '' }, { id: 2, word: 'Tauri', replacement: '' }, { id: 3, word: 'Ququ', replacement: '蛐蛐' }];

function stubDesktop({ text, words }) {
  const handlers = [];
  const api = new Proxy({
    runtime: 'tauri',
    getInterfaceMode: async () => 'classic',
    checkModelFiles: async () => ({ success: true, models_downloaded: true }),
    checkFunASRStatus: async () => ({ success: true, models_initialized: true }),
    transcribeAudio: async () => ({ success: true, text }),
    getSpecialWords: async () => words,
    getSetting: async () => false,
    saveTranscription: async () => ({ success: true }),
    pasteText: async () => ({ success: true }),
    onHotkeyTriggered: handler => { handlers.push(handler); return () => {}; },
  }, {
    get: (target, key) => key in target ? target[key]
      : (String(key).startsWith('on') ? () => () => {} : async () => ({ success: true })),
  });
  window.electronAPI = api;
  window.__hotkey = action => handlers.forEach(handler => handler({}, { action }));
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() {} }] });
  window.MediaRecorder = class {
    static isTypeSupported() { return false; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['x']) }); this.onstop?.(); }
  };
  window.AudioContext = class {
    async decodeAudioData() { return { numberOfChannels: 1, length: 1, sampleRate: 16000, getChannelData: () => new Float32Array(1) }; }
    async close() {}
  };
}

async function measure(browser, baseUrl, { text, dark }) {
  const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
  try {
    await page.addInitScript(stubDesktop, { text, words: WORDS });
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.goto(baseUrl);
    const mic = page.getByRole('button', { name: '開始錄音' });
    await mic.waitFor();
    await page.waitForFunction(() => !document.querySelector('.classic-mic').disabled);
    await page.evaluate(() => window.__hotkey('toggle'));
    await page.getByRole('button', { name: '停止錄音' }).waitFor();
    await page.evaluate(() => window.__hotkey('toggle'));
    await page.getByRole('region', { name: '最近一次聽寫與專有詞彙' }).waitFor();
    return await page.evaluate(() => {
      const card = document.querySelector('section[aria-label="最近一次聽寫與專有詞彙"]');
      const scroller = card.querySelector('.classic-scroll');
      const dock = [...card.querySelectorAll('*')].find(el => el.textContent.trim().startsWith('專有詞彙') && el.querySelector('button'));
      const rect = dock.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      return {
        top: rect.top, bottom: rect.bottom, cardBottom: cardRect.bottom, height: window.innerHeight,
        scrolls: scroller.scrollHeight > scroller.clientHeight,
        pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
      };
    });
  } finally { await page.close(); }
}

(async () => {
  const srcRoot = path.resolve(__dirname, '../src');
  const server = await createServer({ configFile: path.join(srcRoot, 'vite.config.js'), root: srcRoot, logLevel: 'error', server: { port: 5199, strictPort: true } });
  await server.listen();
  const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
  const browser = await chromium.launch({ channel, headless: true });
  try {
    const baseUrl = 'http://localhost:5199/index.html';
    for (const dark of [false, true]) {
      const long = await measure(browser, baseUrl, { text: LONG_TEXT, dark });
      assert.ok(long.top >= 0 && long.bottom <= long.height, `dock must stay in the viewport for long text (dark=${dark}): ${JSON.stringify(long)}`);
      assert.ok(long.bottom <= long.cardBottom, 'dock must stay inside the result card');
      assert.equal(long.scrolls, true, 'long transcript must scroll inside its own area');
      assert.equal(long.pageScrolls, false, 'window itself must not scroll');
    }
    const short = await measure(browser, baseUrl, { text: '早安，今天天氣真好。', dark: false });
    assert.ok(short.top >= 0 && short.bottom <= short.height, 'dock must stay in the viewport for short text');
    process.stdout.write('PASS: Classic vocabulary dock stays visible with long and short results.\n');
  } finally {
    await browser.close();
    await server.close();
  }
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
