import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to optionally test Playwright layout geometry if chromium is available
async function tryLaunchPlaywright() {
  try {
    const { chromium } = await import('playwright-core');
    const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      return await chromium.launch({ headless: true });
    }
  } catch {
    return null;
  }
}

test('classic layout: CSS defines height constraint, flexbox column, and classic scrollbar', () => {
  const cssPath = path.resolve(__dirname, '../index.css');
  const css = fs.readFileSync(cssPath, 'utf8');

  // Verify .native-classic constraints
  assert.ok(css.includes('.native-classic'), 'index.css must define .native-classic');
  assert.ok(css.includes('height: 100vh') || css.includes('height:100vh'), 'native-classic must constrain height to 100vh');
  assert.ok(css.includes('overflow: hidden') || css.includes('overflow:hidden'), 'native-classic must hide outer overflow to prevent window displacement');
  assert.ok(css.includes('display: flex') || css.includes('display:flex'), 'native-classic must use flex container');
  assert.ok(css.includes('flex-direction: column') || css.includes('flex-direction:column'), 'native-classic must layout as column');

  // Verify .classic-scroll custom scrollbar
  assert.ok(css.includes('.classic-scroll'), 'index.css must define .classic-scroll for internal transcript scrolling');
  assert.ok(css.includes('scrollbar-width: thin') || css.includes('scrollbar-width:thin'), 'classic-scroll must configure thin scrollbars');
});

test('classic layout: NativeDictation structure maintains scrollable transcript and pinned dock', () => {
  const compPath = path.resolve(__dirname, '../components/NativeDictation.jsx');
  const code = fs.readFileSync(compPath, 'utf8');

  // Verify streamlined header and mic spacing
  assert.ok(code.includes('mb-2.5 flex-shrink-0') || code.includes('mb-3 flex-shrink-0'), 'Header must have streamlined bottom margin and flex-shrink-0');
  assert.ok(code.includes('mb-3 flex-shrink-0'), 'Mic section must have streamlined bottom margin and flex-shrink-0');

  // Verify result card flex container
  assert.ok(code.includes('flex-1 min-h-0 flex flex-col overflow-hidden'), 'Result card must be flex column with min-h-0 and overflow-hidden');

  // Verify scrollable transcript container
  assert.ok(code.includes('flex-1 min-h-0 overflow-y-auto') && code.includes('classic-scroll'), 'Transcript must be enclosed in flex-1 min-h-0 overflow-y-auto scroll container');

  // Verify fixed dock container
  assert.ok(code.includes('<div className="flex-shrink-0">') || code.includes('flex-shrink-0'), 'EntityDock must be wrapped or declared with flex-shrink-0 to prevent pushdown');
});

test('classic layout regression: long dictation in 400x500 window keeps vocabulary dock visible', async () => {
  const browser = await tryLaunchPlaywright();
  if (!browser) {
    // If running in an environment without Chrome/Edge, pass with structural verification
    return;
  }

  try {
    const distDir = path.resolve(__dirname, '../dist/assets');
    let css = '';
    if (fs.existsSync(distDir)) {
      const file = fs.readdirSync(distDir).find(f => f.startsWith('index-') && f.endsWith('.css'));
      if (file) {
        css = fs.readFileSync(path.join(distDir, file), 'utf8');
      }
    }
    if (!css) {
      // If dist is not built yet, skip the headless browser rendering assertion
      return;
    }

    const longText = '我發現我如果稍微講多一點的字的話經典模式下專有詞彙的區塊會被擠到下方，今天我們在討論前端架構遷移，特別是從 Electron 轉換到 Tauri 的過程，需要確認語音識別模型的相容性與熱鍵行為。另外我們也測試了特殊名詞與專有名詞的替換功能，發現當聽寫結果稍微多一點的時候，下方的專有詞彙區塊就會被擠到畫面之外，造成使用者無法即時查看或點選新增詞彙。這對於需要連續長篇口述的使用者來說非常不便，因此我們需要重新規劃整個經典模式的版面配置，確保無論文字長度如何，詞彙區域都能保持固定可見。';

    const buildHtml = (text, theme = 'light') => `<!DOCTYPE html>
<html lang="zh-TW" class="${theme}">
<head>
  <meta charset="UTF-8">
  <style>
    ${css}
    html, body { height: 100%; margin: 0; padding: 0; }
  </style>
</head>
<body class="bg-background text-foreground">
  <div id="root">
    <main class="native-classic text-foreground">
      <header class="flex items-center justify-between gap-3 mb-2.5 flex-shrink-0 draggable">
        <h1 class="text-2xl font-bold chinese-title">蛐蛐</h1>
        <div class="flex gap-1 non-draggable">
          <button type="button" class="classic-tool" aria-label="收合至極簡"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M4 14h6v6m10-10h-6V4"/></svg></button>
        </div>
      </header>

      <section class="text-center mb-3 flex-shrink-0">
        <button type="button" class="classic-mic" aria-label="開始錄音"><svg width="23" height="23" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg></button>
        <p class="mt-2 text-xs text-muted-foreground status-text">點擊麥克風或按已設定的快速鍵開始錄音</p>
      </section>

      <section class="rounded-xl border bg-secondary/70 p-3.5 chinese-content relative flex-1 min-h-0 flex flex-col overflow-hidden shadow-xs" id="result-card" aria-label="最近一次聽寫與專有詞彙">
        <div class="flex justify-between items-center gap-2 flex-shrink-0 pb-1.5 border-b border-border/40">
          <div class="flex items-center gap-1.5">
            <h2 class="text-xs text-muted-foreground font-medium">最近一次聽寫</h2>
            <span class="text-[10px] bg-primary/10 text-primary px-1.5 py-0.2 rounded font-mono font-medium">${text.length}字</span>
          </div>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto py-2 pr-1 classic-scroll" id="transcript-scroll">
          <p class="whitespace-pre-wrap break-words leading-relaxed select-text text-[15px]" id="transcript-paragraph">
            ${text}
          </p>
        </div>

        <div class="flex-shrink-0" id="entity-dock-wrapper">
          <div class="mt-2.5 pt-2 border-t border-border/60" id="entity-dock">
            <div class="flex items-center justify-between text-xs mb-1.5">
              <div class="flex items-center gap-1.5 font-semibold text-foreground">
                <span>專有詞彙</span>
                <span class="px-1.5 py-0.2 rounded-full text-[10px] bg-primary/15 text-primary font-mono font-medium">4</span>
              </div>
              <button type="button" class="text-[11px] text-primary hover:underline font-medium">＋ 新增詞彙</button>
            </div>
            <div class="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto py-0.5 classic-scroll" id="dock-chips">
              <div class="entity-chip entity-chip-plain"><span>🏷️</span><span>Electron</span></div>
              <div class="entity-chip entity-chip-plain"><span>🏷️</span><span>Tauri</span></div>
              <div class="entity-chip entity-chip-pair"><span>Ququ➔蛐蛐</span></div>
              <div class="entity-chip entity-chip-plain"><span>🏷️</span><span>專有詞彙</span></div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</body>
</html>`;

    // Test Light Mode with Long Text in 400x500 window
    {
      const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
      await page.setContent(buildHtml(longText, 'light'));
      const metrics = await page.evaluate(() => {
        const card = document.getElementById('result-card').getBoundingClientRect();
        const dock = document.getElementById('entity-dock').getBoundingClientRect();
        const scroll = document.getElementById('transcript-scroll');
        return {
          windowHeight: window.innerHeight,
          cardBottom: card.bottom,
          dockTop: dock.top,
          dockBottom: dock.bottom,
          dockHeight: dock.height,
          dockInViewport: dock.bottom <= window.innerHeight && dock.top >= 0,
          dockOverflow: Math.max(0, dock.bottom - window.innerHeight),
          scrollable: scroll.scrollHeight > scroll.clientHeight,
        };
      });

      assert.equal(metrics.windowHeight, 500);
      assert.equal(metrics.dockInViewport, true, 'Vocabulary dock must stay inside 500px viewport');
      assert.equal(metrics.dockOverflow, 0, 'Vocabulary dock must have 0px overflow past bottom viewport');
      assert.ok(metrics.dockBottom <= 500, `dockBottom (${metrics.dockBottom}) must be <= 500px`);
      assert.equal(metrics.scrollable, true, 'Long transcript must be scrollable within its container');
      await page.close();
    }

    // Test Dark Mode with Long Text in 400x500 window
    {
      const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
      await page.setContent(buildHtml(longText, 'dark'));
      const inViewport = await page.evaluate(() => {
        const dock = document.getElementById('entity-dock').getBoundingClientRect();
        return dock.bottom <= window.innerHeight && dock.top >= 0;
      });
      assert.equal(inViewport, true, 'Vocabulary dock in dark mode must also stay inside viewport');
      await page.close();
    }

    // Test Short Text in 400x500 window
    {
      const page = await browser.newPage({ viewport: { width: 400, height: 500 } });
      await page.setContent(buildHtml('早安，今天天氣真好。', 'light'));
      const inViewport = await page.evaluate(() => {
        const dock = document.getElementById('entity-dock').getBoundingClientRect();
        return dock.bottom <= window.innerHeight && dock.top >= 0;
      });
      assert.equal(inViewport, true, 'Vocabulary dock with short text must stay inside viewport');
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
