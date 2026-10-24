const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ channel:process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'msedge':'chrome'), headless:true });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const api = {
      runtime:'tauri', getInterfaceMode:async()=> 'classic', onInterfaceModeChanged:()=>()=>{}, getHotkeyConfig:async()=>({key:'Control+Shift+Space',mode:'toggle'}), getAllSettings:async()=>({}), getSetting:async(_,fallback)=>fallback,
      getCurrentHotkey:async()=> 'CommandOrControl+Shift+Space', registerHotkey:async()=>({success:true}),
      setRecordingState:async()=>({success:true}), log:async()=>{},
      checkModelFiles:async()=>({success:true,models_downloaded:true}),
      checkFunASRStatus:async()=>({success:true,models_initialized:true}),
      getTranscriptions:async()=>[{id:1,text:'Recorded theme test',raw_text:'Recorded theme test',created_at:'2026-10-23 12:00:00'}],
    };
    for(const event of ['onHotkeyTriggered','onToggleDictation','onModelDownloadProgress','onProcessingUpdate','onSettingsUpdate']) api[event]=()=>()=>{};
    window.electronAPI=api;
  });
  const page = await context.newPage();
  const results=[];
  const failures=[];
  for(const mode of ['light','dark']) {
    await page.emulateMedia({colorScheme:mode});
    await page.goto('http://localhost:5173/settings.html');
    const heading=page.getByText('本機語音引擎',{exact:true});await heading.waitFor();
    const settings=await heading.evaluate(el=>({color:getComputedStyle(el).color,body:getComputedStyle(document.body).color,dark:document.documentElement.classList.contains('dark')}));
    await page.screenshot({path:`.lavish/settings-theme-${mode}.png`,fullPage:true});
    await page.goto('http://localhost:5173/?panel=control');
    await page.waitForFunction(()=>typeof window.onTranscriptionComplete==='function');
    await page.evaluate(()=>window.onTranscriptionComplete({success:true,text:'Recorded theme test'}));
    const recording=page.getByText('Recorded theme test',{exact:true});await recording.waitFor();
    const script=await recording.evaluate(el=>({color:getComputedStyle(el).color,body:getComputedStyle(document.body).color}));
    await page.screenshot({path:`.lavish/recording-theme-${mode}.png`});
    await page.goto('http://localhost:5173/history.html');
    await page.getByText('Recorded theme test',{exact:true}).waitFor();
    const history=await page.getByText('Recorded theme test',{exact:true}).evaluate(el=>({color:getComputedStyle(el).color,body:getComputedStyle(document.body).color,dark:document.documentElement.classList.contains('dark')}));
    results.push({mode,settings,script,history});
    try {
      assert.equal(settings.dark,mode==='dark','settings must track system theme');
      assert.equal(history.dark,mode==='dark','history must track system theme');
      assert.equal(settings.color,settings.body,'settings primary text must use the theme foreground');
      assert.equal(script.color,script.body,'recorded text must use the theme foreground');
      assert.equal(history.color,history.body,'history transcript must use the theme foreground');
      assert.equal(settings.color,script.color,'settings and recorded text must share the primary text color');
    } catch(error) {failures.push(`${mode}: ${error.message}`);}
  }
  await page.goto('http://localhost:5173/settings.html');
  await page.getByText('本機語音引擎',{exact:true}).waitFor();
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>!document.documentElement.classList.contains('dark'));
  await page.emulateMedia({colorScheme:'dark'});
  try {await page.waitForFunction(()=>document.documentElement.classList.contains('dark'),{},{timeout:2000});}
  catch {failures.push('settings must react to system theme changes without reloading');}
  fs.writeFileSync('.lavish/theme-results.json',JSON.stringify(results,null,2));
  await browser.close();
  if(failures.length)throw new Error(failures.join('\n'));
  process.stdout.write('PASS: settings, recorded text and history use consistent theme colors in light/dark mode; live theme changes work.\n');
})().catch(error=>{process.stderr.write(`${error.stack}\n`);process.exit(1)});
