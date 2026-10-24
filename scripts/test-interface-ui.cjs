const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext();
  await context.addInitScript(()=>{
    window.calls=[];window.handlers={};let phase='idle';
    const api={runtime:'tauri',getInterfaceMode:async()=>localStorage.getItem('test-mode')||'classic',
      setInterfaceMode:async mode=>{if(phase!=='idle')throw new Error('请先完成这次听写');localStorage.setItem('test-mode',mode);window.handlers.onInterfaceModeChanged?.({}, {mode});return{success:true};},
      setDictationPhase:async value=>{phase=value;window.calls.push(['phase',value]);},
      log:async(_,message)=>window.calls.push(['log',message]),getSetting:async()=>false,
      checkModelFiles:async()=>({success:true,models_downloaded:true}),checkFunASRStatus:async()=>({success:true,models_initialized:true}),
      setRecordingState:async value=>window.calls.push(['recording',value]),reportDictationError:async error=>window.calls.push(['error',error]),invalidateDictation:async()=>{},
      transcribeAudio:async bytes=>{window.calls.push(['transcribe',bytes.length]);return{success:true,text:'同一个听写流程',raw_text:'同一个听写流程'};},
      saveTranscription:async row=>window.calls.push(['save',row.text]),pasteText:async text=>{window.calls.push(['paste',text]);return{success:true};},copyText:async()=>({success:true}),
    };
    for(const name of ['onInterfaceModeChanged','onHotkeyTriggered','onProcessingUpdate','onSettingsUpdate','onModelDownloadProgress'])api[name]=callback=>{window.handlers[name]=callback;return()=>delete window.handlers[name];};
    window.electronAPI=api;
    Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{window.calls.push(['microphone']);return{getTracks:()=>[{stop:()=>{}}]};}}});
    window.MediaRecorder=class{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([1,2])])});queueMicrotask(()=>this.onstop?.());}};
    window.AudioContext=class{async decodeAudioData(){return{numberOfChannels:1,length:160,sampleRate:16000,getChannelData:()=>new Float32Array(160)};}async close(){}};
  });
  const page=await context.newPage();
  await page.goto('http://localhost:5173/');
  await page.getByRole('button',{name:'开始录音',exact:true}).waitFor({state:'visible'});
  await page.getByRole('button',{name:'开始录音',exact:true}).click();
  await page.getByRole('button',{name:'停止录音',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'收起到极简'}).isDisabled(),true);
  assert.equal(await page.evaluate(async()=>{try{await window.electronAPI.setInterfaceMode('compact');return false;}catch{return true;}}),true);
  await page.getByRole('button',{name:'停止录音',exact:true}).click();
  await page.getByText('同一个听写流程',{exact:true}).waitFor();
  await page.waitForFunction(()=>window.calls.some(call=>call[0]==='phase'&&call[1]==='idle'));
  await page.getByRole('button',{name:'收起到极简'}).click();
  await page.locator('.recording-indicator').waitFor({state:'attached'});
  await page.evaluate(()=>window.electronAPI.setInterfaceMode('classic'));
  await page.getByText('同一个听写流程',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call[0]==='microphone').length),1,'switch must not remount recorder');
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call[0]==='save').length),1);
  assert.equal(await page.evaluate(()=>window.calls.filter(call=>call[0]==='paste').length),1);
  const metrics=await page.evaluate(()=>JSON.parse(window.calls.find(call=>call[0]==='log'&&call[1].startsWith('dictation-performance '))[1].slice('dictation-performance '.length)));
  assert.ok(Object.values(metrics).every(value=>typeof value==='number'));
  await page.emulateMedia({colorScheme:'dark'});
  await page.screenshot({path:'.lavish/classic-interface-dark.png'});
  await page.getByRole('button',{name:'收起到极简'}).click();
  await page.reload();await page.locator('.recording-indicator').waitFor({state:'attached'});
  assert.equal(await page.locator('.native-classic').count(),0,'saved Compact survives reload');
  await page.evaluate(()=>window.handlers.onHotkeyTriggered({}, {action:'start'}));
  await page.waitForFunction(()=>document.querySelector('.is-recording'));
  await page.evaluate(()=>window.handlers.onHotkeyTriggered({}, {action:'cancel'}));
  await page.waitForTimeout(220);
  assert.equal(await page.evaluate(()=>window.calls.some(call=>call[0]==='save')),false,'Compact cancellation must not save');
  await browser.close();
  process.stdout.write('PASS Classic/Compact: shared recorder/results, busy rejection, persistence, numeric metrics and cancellation.\n');
})().catch(error=>{process.stderr.write(`${error.stack}\n`);process.exit(1);});
