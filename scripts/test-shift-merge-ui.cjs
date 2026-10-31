const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const URL=process.env.UI_URL||'http://localhost:5173/';
const TEXT='alpha beta, gamma delta';
const SHOTS='.lavish';

(async()=>{
  fs.mkdirSync(SHOTS,{recursive:true});
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL||(process.platform==='win32'?'msedge':'chrome'),headless:true});

  async function openWithTranscript(text){
    const context=await browser.newContext({viewport:{width:900,height:900}});
    await context.addInitScript(text=>{
      window.calls=[];window.handlers={};let phase='idle';let nextId=1;const words=[];
      const api={runtime:'tauri',getInterfaceMode:async()=>'classic',setInterfaceMode:async()=>({success:true}),
        setDictationPhase:async value=>{phase=value;},log:async()=>{},getSetting:async()=>false,
        checkModelFiles:async()=>({success:true,models_downloaded:true}),checkFunASRStatus:async()=>({success:true,models_initialized:true}),
        setRecordingState:async()=>{},reportDictationError:async()=>{},invalidateDictation:async()=>{},
        transcribeAudio:async()=>({success:true,text,raw_text:text}),saveTranscription:async()=>{},
        pasteText:async()=>({success:true}),copyText:async()=>({success:true}),
        getSpecialWords:async()=>words.map(item=>({...item})),
        saveSpecialWord:async({word,replacement})=>{window.calls.push(['saveSpecialWord',word,replacement]);words.push({id:nextId++,word,replacement:replacement||''});return{success:true};},
        deleteSpecialWord:async id=>{const i=words.findIndex(w=>w.id===id);if(i>=0)words.splice(i,1);return{success:true};},
      };
      for(const name of ['onInterfaceModeChanged','onHotkeyTriggered','onProcessingUpdate','onSettingsUpdate','onModelDownloadProgress','onSpecialWordsUpdate'])api[name]=callback=>{window.handlers[name]=callback;return()=>delete window.handlers[name];};
      window.electronAPI=api;
      Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>{}}]})}});
      window.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([1,2])])});queueMicrotask(()=>this.onstop?.());}};
      window.AudioContext=class{async decodeAudioData(){return{numberOfChannels:1,length:160,sampleRate:16000,getChannelData:()=>new Float32Array(160)};}async close(){}};
    },text);
    const page=await context.newPage();
    await page.goto(URL);
    await page.getByRole('button',{name:'開始錄音',exact:true}).click();
    await page.getByRole('button',{name:'停止錄音',exact:true}).click();
    await page.locator('[data-token-index]').first().waitFor();
    return {page,context};
  }

  const token=(page,text)=>page.locator('[data-token-index]',{hasText:text}).filter({hasText:new RegExp(`^${text}$`)}).first();
  const shiftClick=(page,text)=>token(page,text).click({modifiers:['Shift']});

  async function mergeAndSave(name,first,second,expected){
    const {page,context}=await openWithTranscript(TEXT);
    await token(page,first).click();
    await shiftClick(page,second);
    const input=page.getByLabel('辨識詞彙',{exact:true});
    await input.waitFor();
    await page.waitForFunction(value=>document.querySelector('input[aria-label="辨識詞彙"]')?.value===value,expected,{timeout:3000});
    assert.equal(await input.inputValue(),expected,`${name}: proposed term`);
    assert.equal(await page.locator('[data-selected="true"]').evaluateAll(els=>els.map(el=>el.textContent).join('')),expected,`${name}: highlighted span`);
    await page.screenshot({path:`${SHOTS}/shift-merge-${name}-popover.png`});
    await page.getByRole('button',{name:'儲存詞彙'}).click();
    const chip=page.locator('.entity-chip-plain',{hasText:expected});
    await chip.waitFor();
    assert.equal(await page.locator('.entity-chip').count(),1,`${name}: exactly one chip`);
    assert.deepEqual(await page.evaluate(()=>window.calls.filter(c=>c[0]==='saveSpecialWord')),[['saveSpecialWord',expected,'']],`${name}: saved once as one phrase`);
    await page.screenshot({path:`${SHOTS}/shift-merge-${name}-chip.png`});
    await context.close();
  }

  // Scenario 1: Shift-click a second adjacent word combines both into one chip.
  await mergeAndSave('adjacent-words','alpha','beta','alpha beta');
  // Scenario 2: Shift-click across whitespace and punctuation, in both click orders.
  await mergeAndSave('span-forward','alpha','gamma','alpha beta, gamma');
  await mergeAndSave('span-reverse','gamma','alpha','alpha beta, gamma');

  await browser.close();
  process.stdout.write('PASS Shift-click merge: adjacent words, and spans across whitespace/punctuation in both click orders, become one vocabulary chip.\n');
})().catch(error=>{process.stderr.write(`${error.stack}\n`);process.exit(1);});
