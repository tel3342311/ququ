// Drives the real Classic NativeDictation UI through a streaming dictation with a
// fake microphone worklet and a fake engine: the draft appears while recording,
// stopping commits only the engine's final text, and the offline path never runs.
const { chromium } = require('playwright-core');
const { createServer } = require('vite');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function stubDesktop() {
  const handlers = [];
  const calls = [];
  window.__calls = calls;
  const api = new Proxy({
    runtime: 'tauri',
    getInterfaceMode: async () => 'classic',
    checkModelFiles: async () => ({ success: true, models_downloaded: false }),
    checkFunASRStatus: async () => ({ success: true, models_initialized: false }),
    getSpecialWords: async () => [],
    getSetting: async key => key === 'streaming_enabled' ? true : false,
    streamStatus: async () => ({ success: true, installed: true, download_bytes: 1 }),
    streamStart: async () => { calls.push('start'); return { success: true, session: 5 }; },
    streamPush: async (id, pcm) => { calls.push(`push:${id}:${pcm.length}`); return { success: true, draft: '你好 draft' }; },
    streamFinish: async id => { calls.push(`finish:${id}`); return { success: true, text: '你好，最終結果。', raw_text: '你好最終結果', duration: 1 }; },
    streamCancel: async id => { calls.push(`cancel:${id}`); return { success: true }; },
    transcribeAudio: async () => { calls.push('OFFLINE'); return { success: false }; },
    saveTranscription: async data => { calls.push(`save:${data.text}`); return { success: true }; },
    pasteText: async text => { calls.push(`paste:${text}`); return { success: true }; },
    onHotkeyTriggered: handler => { handlers.push(handler); return () => { handlers.splice(handlers.indexOf(handler), 1); }; },
  }, {
    get: (target, key) => key in target ? target[key]
      : (String(key).startsWith('on') ? () => () => {} : async () => ({ success: true })),
  });
  window.electronAPI = api;
  window.__hotkey = action => [...handlers].forEach(handler => handler({}, { action }));
  navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop() { calls.push('mic-closed'); } }] });
  window.AudioContext = class {
    constructor() { this.audioWorklet = { addModule: async () => {} }; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async close() {}
  };
  window.AudioWorkletNode = class {
    constructor() {
      this.port = { postMessage: message => { if (message === 'flush') queueMicrotask(() => this.port.onmessage?.({ data: { flushed: true } })); } };
      window.__node = this;
    }
    disconnect() {}
  };
  window.__emitChunk = () => window.__node.port.onmessage({ data: { chunk: new Float32Array(3200).fill(0.1) } });
}

(async () => {
  const srcRoot = path.resolve(__dirname, '../src');
  process.chdir(srcRoot);
  const server = await createServer({ configFile: path.join(srcRoot, 'vite.config.js'), root: srcRoot, logLevel: 'error', server: { port: 5198, strictPort: true } });
  await server.listen();
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
  const browser = await chromium.launch(executablePath ? { executablePath, headless: true, args: ['--no-sandbox'] } : { channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
    await page.addInitScript(stubDesktop);
    await page.goto('http://localhost:5198/index.html');
    // The offline model is not installed; streaming alone must make recording possible.
    await page.waitForFunction(() => { const mic = document.querySelector('.classic-mic'); return mic && !mic.disabled; });
    await page.evaluate(() => window.__hotkey('toggle'));
    await page.getByRole('button', { name: '停止錄音' }).waitFor();
    await page.evaluate(() => window.__emitChunk());
    await page.getByLabel('即時辨識草稿').waitFor();
    assert.match(await page.getByLabel('即時辨識草稿').innerText(), /你好 draft/);
    await page.evaluate(() => window.__hotkey('toggle'));
    await page.getByRole('region', { name: '最近一次聽寫與專有詞彙' }).waitFor();
    assert.match(await page.locator('section[aria-label="最近一次聽寫與專有詞彙"]').innerText(), /你好，最終結果。/);
    assert.equal(await page.getByLabel('即時辨識草稿').count(), 0, 'draft panel must disappear after stopping');
    const calls = await page.evaluate(() => window.__calls);
    assert.ok(!calls.includes('OFFLINE'), `offline path must not run: ${calls}`);
    assert.ok(calls.includes('paste:你好，最終結果。'), `final text must be pasted: ${calls}`);
    assert.ok(calls.indexOf('push:5:3200') < calls.indexOf('finish:5'), 'audio must be pushed before finishing');
    assert.ok(!calls.some(call => call.includes('draft')), 'a draft must never be saved or pasted');

    // Cancel mid-stream: the engine session is cancelled and nothing is committed.
    await page.evaluate(() => { window.__calls.length = 0; });
    await page.evaluate(() => window.__hotkey('toggle'));
    await page.getByRole('button', { name: '停止錄音' }).waitFor();
    await page.evaluate(() => window.__emitChunk());
    await page.getByLabel('即時辨識草稿').waitFor();
    await page.evaluate(() => window.__hotkey('cancel'));
    await page.waitForFunction(() => window.__calls.some(call => call.startsWith('cancel:')));
    const after = await page.evaluate(() => window.__calls);
    assert.ok(!after.some(call => call.startsWith('paste:') || call.startsWith('save:') || call.startsWith('finish:')), `cancel must commit nothing: ${after}`);
    process.stdout.write('PASS: streaming shows a live draft, commits only the final text, and cancel commits nothing.\n');
  } finally {
    await browser.close();
    await server.close();
  }
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
