// Opt-in smoke test against a running Windows WebView2 app with CDP enabled.
// Launch only the app under test with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function findPage(browser, suffix) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const page = browser.contexts().flatMap(context => context.pages()).find(page => {
      const pathname = new URL(page.url()).pathname;
      return pathname.endsWith(suffix) || (suffix === 'index.html' && pathname === '/');
    });
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Native window did not load: ${suffix}`);
}

(async () => {
  const browser = await chromium.connectOverCDP(process.env.QUQU_CDP_ENDPOINT || 'http://127.0.0.1:9223');
  const main = await findPage(browser, 'index.html');
  await main.waitForFunction(() => document.getElementById('root')?.textContent.trim().length > 0);
  assert.equal(await main.evaluate(() => window.electronAPI.runtime), 'tauri');
  assert.equal(await main.evaluate(() => window.electronAPI.getAppVersion()), '1.0.0');
  const output = path.resolve('.lavish'); fs.mkdirSync(output, { recursive: true });
  await main.screenshot({path:path.join(output, 'native-main.png')});

  await main.evaluate(() => window.electronAPI.openSettingsWindow());
  const settings = await findPage(browser, 'settings.html');
  await settings.getByText('本機語音引擎', {exact:true}).waitFor();
  assert.equal(await settings.evaluate(() => window.electronAPI.runtime), 'tauri');
  const originalMode=await settings.evaluate(()=>window.electronAPI.getInterfaceMode());
  try {
    await settings.evaluate(()=>window.electronAPI.setInterfaceMode('classic'));
    await main.getByRole('button',{name:'開始錄音',exact:true}).waitFor();
    await main.waitForFunction(async()=>{const info=await window.electronAPI.getDebugInfo();return info.interfaceMode==='classic'&&info.mainVisible;});
    let info=await main.evaluate(()=>window.electronAPI.getDebugInfo());
    assert.equal(info.mainFocusable,true);
    assert.ok(Math.abs(info.mainSize.width/info.mainSize.height-0.8)<0.02,'Classic native size must be 400:500');
    await main.screenshot({path:path.join(output,'native-classic.png')});
    await settings.getByRole('radio',{name:/極簡/}).click();
    await settings.waitForFunction(()=>document.querySelector('input[name="interface-mode"][value="compact"]')?.checked);
    await main.locator('.recording-indicator').waitFor({state:'attached'});
    await main.waitForFunction(async()=>!(await window.electronAPI.getDebugInfo()).mainVisible);
    info=await main.evaluate(()=>window.electronAPI.getDebugInfo());
    assert.equal(info.interfaceMode,'compact');assert.equal(info.mainFocusable,false);
    assert.equal(await settings.evaluate(()=>window.electronAPI.getSetting('interface_mode',null)),'compact','mode must persist in SQLite');
    await settings.reload();await settings.getByRole('radio',{name:/極簡/}).waitFor();
    assert.equal(await settings.getByRole('radio',{name:/極簡/}).isChecked(),true);
    for(const phase of ['starting','recording','processing','optimizing']) {
      await main.evaluate(value=>window.electronAPI.setDictationPhase(value),phase);
      assert.equal(await settings.evaluate(async()=>{try{await window.electronAPI.setInterfaceMode('classic');return false;}catch{return true;}}),true,`must reject while ${phase}`);
      assert.equal(await main.evaluate(()=>window.electronAPI.getInterfaceMode()),'compact');
    }
    await main.evaluate(()=>window.electronAPI.setDictationPhase('idle'));
    await settings.evaluate(()=>window.electronAPI.setInterfaceMode('classic'));
    await main.getByRole('button',{name:'收合至極簡'}).click();
    await main.locator('.recording-indicator').waitFor({state:'attached'});
    assert.equal(await main.evaluate(()=>window.electronAPI.getInterfaceMode()),'compact');
  } finally {
    await main.evaluate(()=>window.electronAPI.setDictationPhase('idle'));
    await settings.evaluate(mode=>window.electronAPI.setInterfaceMode(mode),originalMode);
  }
  const options = await settings.locator('select option').allTextContents();
  assert.ok(options.some(value => value.includes('SenseVoice')));
  await settings.getByText('錄音快速鍵',{exact:true}).waitFor();
  const original=await settings.evaluate(()=>window.electronAPI.getHotkeyConfig());
  try {
    await settings.getByRole('button',{name:'重新擷取'}).click();
    await settings.getByRole('button',{name:'請按快速鍵…'}).waitFor();
    await settings.keyboard.down('ControlLeft');await settings.keyboard.up('ControlLeft');
    await settings.getByRole('button',{name:'儲存快速鍵'}).click();
    await settings.getByText('快速鍵已儲存。',{exact:true}).waitFor();
    assert.equal((await settings.evaluate(()=>window.electronAPI.getHotkeyConfig())).key,'ControlLeft');
    await settings.getByLabel('錄音方式').selectOption('hold');
    await settings.getByRole('button',{name:'儲存快速鍵'}).click();
    await settings.getByText('快速鍵已儲存。',{exact:true}).waitFor();
    assert.equal((await settings.evaluate(()=>window.electronAPI.getHotkeyConfig())).mode,'hold');
    await settings.getByRole('button',{name:'重新擷取'}).click();
    await settings.getByRole('button',{name:'請按快速鍵…'}).waitFor();
    await settings.keyboard.press('Escape');
    await settings.getByText('已取消擷取。',{exact:true}).waitFor();
    await settings.reload();await settings.getByText('ControlLeft',{exact:true}).waitFor();
    const rejected=await settings.evaluate(async()=>{try{await window.electronAPI.setHotkeyConfig({key:'A',mode:'toggle'});return false}catch{return true}});
    assert.equal(rejected,true,'bare typing keys must be rejected');
    assert.equal((await settings.evaluate(()=>window.electronAPI.getHotkeyConfig())).key,'ControlLeft');
  } finally {await settings.evaluate(config=>window.electronAPI.setHotkeyConfig(config),original);}
  await settings.screenshot({path:path.join(output, 'native-settings.png'), fullPage:true});
  const settingsClosed = settings.waitForEvent('close');
  await main.evaluate(() => window.electronAPI.closeSettingsWindow());
  await settingsClosed;

  await main.evaluate(() => window.electronAPI.openHistoryWindow());
  const history = await findPage(browser, 'history.html');
  await history.waitForFunction(() => document.getElementById('history-root')?.textContent.trim().length > 0);
  await main.evaluate(() => window.electronAPI.closeHistoryWindow());
  for (let attempt=0; attempt<50 && !history.isClosed(); attempt++) await new Promise(resolve => setTimeout(resolve,100));
  assert.equal(history.isClosed(), true, 'Closing history must destroy its WebView');
  await main.evaluate(() => window.electronAPI.openHistoryWindow());
  const reopened = await findPage(browser, 'history.html');
  assert.notEqual(reopened, history, 'Reopened history must mount a fresh page');
  await main.evaluate(() => window.electronAPI.closeHistoryWindow());
  process.stdout.write('PASS: native Classic/Compact switching, persisted settings, every busy-phase rejection, collapse, hotkeys, SenseVoice and history. Screenshots saved in .lavish/.\n');
  // This process owns no browser; disconnect without closing the user's app.
  process.exit(0);
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
