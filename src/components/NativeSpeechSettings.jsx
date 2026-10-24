import React, { useEffect, useState } from 'react';
import { languagesForEngine } from '../desktop/model-state.mjs';

export default function NativeSpeechSettings() {
  const api = window.electronAPI;
  const [engine, setEngine] = useState('sense_voice');
  const [language, setLanguage] = useState('zh');
  const [normalization, setNormalization] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (api?.runtime !== 'tauri') return;
    let active = true;
    api.getAllSettings().then(values => {
      if (!active) return;
      setEngine(values.speech_engine === 'sensevoice' ? 'sense_voice' : values.speech_engine || 'sense_voice');
      setLanguage(values.speech_language || 'zh');
      setNormalization(values.sensevoice_use_itn !== false);
    }).catch(error => { if (active) setStatus(error.message || String(error)); });
    const dispose = api.onModelDownloadProgress((_, progress) => {
      if (active) setStatus(`${progress.model}: ${Math.round(progress.overall_progress || 0)}%`);
    });
    return () => { active = false; dispose(); };
  }, [api]);
  if (api?.runtime !== 'tauri') return null;
  const apply = async download => {
    setBusy(true); setStatus(download ? '正在下载并验证模型…' : '正在初始化…');
    try {
      const result = download ? await api.downloadModels(engine) : await api.switchModel(engine);
      if (!result.success) throw new Error(result.error || '模型切换失败');
      await api.setSetting('speech_language', language);
      await api.setSetting('sensevoice_use_itn', normalization);
      setStatus('语音模型已就绪，设置已保存。');
    } catch (error) { setStatus(error.message || String(error)); }
    finally { setBusy(false); }
  };
  return <section className="rounded-lg border p-5 space-y-4 text-foreground">
    <h2 className="text-lg font-semibold">本地语音引擎</h2>
    <p className="text-sm text-muted-foreground">模型在本机执行。先下载目标模型，再切换；初始化失败时保留原来的引擎。</p>
    <label className="block">识别模型<select disabled={busy} value={engine} onChange={e => { setEngine(e.target.value); if (!languagesForEngine(e.target.value).includes(language)) setLanguage('zh'); }} className="mt-1 block w-full rounded border p-2 bg-background text-foreground">
      <option value="sense_voice">SenseVoiceSmall INT8（中 / 粤 / 英 / 日 / 韩）</option><option value="paraformer">Paraformer（中 / 英）</option>
    </select></label>
    <label className="block">语言<select disabled={busy} value={language} onChange={e => setLanguage(e.target.value)} className="mt-1 block w-full rounded border p-2 bg-background text-foreground">
      {[['zh','中文'],['auto','自动'],['yue','粤语'],['en','英文'],['ja','日文'],['ko','韩文']].filter(([value]) => languagesForEngine(engine).includes(value)).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label className="flex items-center gap-2"><input disabled={busy} type="checkbox" checked={normalization} onChange={e => setNormalization(e.target.checked)} />{engine === 'sense_voice' ? '标点与文字正規化（SenseVoice）' : '恢复标点'}</label>
    <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => apply(true)} className="rounded bg-blue-600 text-white px-4 py-2 disabled:opacity-50">下载并切换</button><button disabled={busy} onClick={() => apply(false)} className="rounded border px-4 py-2 disabled:opacity-50">使用已下载模型</button></div>
    <p role="status" className="text-sm break-words">{status}</p>
  </section>;
}
