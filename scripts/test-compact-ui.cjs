const {chromium}=require('playwright-core');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext();
 await context.addInitScript(()=>{
  window.calls=[];window.handlers={};
  const api={runtime:'tauri',getInterfaceMode:async()=> 'compact',setDictationPhase:async()=>{},log:async()=>{},getSetting:async(_,fallback)=>false,
   checkModelFiles:async()=>({success:true,models_downloaded:true}),checkFunASRStatus:async()=>({success:true,models_initialized:true}),
   setRecordingState:async v=>window.calls.push(['recording',v]),reportDictationError:async e=>window.calls.push(['error',e]),
   transcribeAudio:async bytes=>{window.calls.push(['transcribe',bytes.length]);return{success:true,text:'测试听写'}},
   saveTranscription:async row=>window.calls.push(['save',row.text]),pasteText:async t=>{window.calls.push(['paste',t]);return{success:true}},
  };
  for(const name of ['onInterfaceModeChanged','onHotkeyTriggered','onProcessingUpdate','onSettingsUpdate','onModelDownloadProgress'])api[name]=fn=>{window.handlers[name]=fn;return()=>delete window.handlers[name]};
  api.invalidateDictation=async()=>{};window.electronAPI=api;
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop:()=>window.calls.push(['track-stop'])}]})}});
  window.MediaRecorder=class{static isTypeSupported(){return true}constructor(){this.state='inactive';this.mimeType='audio/webm'}start(){this.state='recording'}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([new Uint8Array([1,2])])});queueMicrotask(()=>this.onstop?.())}};
  window.AudioContext=class{async decodeAudioData(){return{numberOfChannels:1,length:160,sampleRate:16000,getChannelData:()=>new Float32Array(160)}}async close(){}};
 });
 const page=await context.newPage();await page.goto('http://localhost:5173/');await page.waitForTimeout(600);
 const dot=page.locator('.recording-indicator');assert.equal(await dot.count(),1);
 assert.equal(await dot.evaluate(e=>getComputedStyle(e).opacity),'0');
 const fire=action=>page.evaluate(action=>window.handlers.onHotkeyTriggered({}, {action}),action);
 await fire('toggle');await page.waitForFunction(()=>document.querySelector('.is-recording'));
 await page.waitForTimeout(220);
 assert.deepEqual(await dot.evaluate(e=>({width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height,opacity:getComputedStyle(e).opacity})),{width:160,height:32,opacity:'1'});
 await page.getByText('Recording...', {exact:true}).waitFor();
 const bounds=await dot.evaluate(el=>{const box=el.getBoundingClientRect(),label=el.querySelector('.recording-label').getBoundingClientRect(),dot=el.querySelector('.recording-dot').getBoundingClientRect();return{fits:label.right<=box.right&&label.bottom<=box.bottom&&dot.left>=box.left,overflow:el.scrollWidth>el.clientWidth,animation:getComputedStyle(el.querySelector('.recording-dot')).animationName};});
 assert.equal(bounds.fits,true);assert.equal(bounds.overflow,false);assert.notEqual(bounds.animation,'none');
 const breathing=await page.locator('.recording-dot').evaluate(el=>{const animation=el.getAnimations()[0];animation.pause();animation.currentTime=0;const low=Number(getComputedStyle(el).opacity);animation.currentTime=900;const high=Number(getComputedStyle(el).opacity);animation.play();return{low,high};});
 assert.ok(breathing.high>breathing.low+.3,'dot opacity must breathe');
 for(const colorScheme of ['light','dark']) {
   await page.emulateMedia({colorScheme});
   await page.waitForFunction(dark=>document.documentElement.classList.contains('dark')===dark,colorScheme==='dark');
   assert.equal(await page.locator('.recording-label').evaluate(el=>getComputedStyle(el).color),await page.evaluate(()=>getComputedStyle(document.body).color));
   await dot.screenshot({path:`.lavish/compact-recording-${colorScheme}.png`});
 }
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await page.locator('.recording-dot').evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.screenshot({path:'.lavish/compact-recording.png'});
 await fire('toggle');await page.waitForFunction(()=>window.calls.some(c=>c[0]==='paste'));
 let calls=await page.evaluate(()=>window.calls);assert.equal(calls.filter(c=>c[0]==='save').length,1);assert.equal(calls.filter(c=>c[0]==='paste').length,1);
 await fire('start');await page.waitForFunction(()=>document.querySelector('.is-recording'));await fire('cancel');await page.waitForTimeout(250);
 calls=await page.evaluate(()=>window.calls);assert.equal(calls.filter(c=>c[0]==='save').length,1);assert.equal(calls.filter(c=>c[0]==='paste').length,1);
 assert.equal(await dot.evaluate(e=>getComputedStyle(e).opacity),'0');
 await browser.close();process.stdout.write('PASS compact 160x32 breathing dot/text, reduced-motion, fit, toggle dictation, cancellation, fade-out, single save/paste.\n');
})().catch(e=>{console.error(e);process.exit(1)});
