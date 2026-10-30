import React, { useEffect, useState } from 'react';

const MB = 1024 * 1024;

export default function StreamingSpeechSettings() {
  const api = window.electronAPI;
  const [enabled, setEnabled] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [downloadBytes, setDownloadBytes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  useEffect(() => {
    if (api?.runtime !== 'tauri' || typeof api.streamStatus !== 'function') return;
    let active = true;
    Promise.all([api.getSetting('streaming_enabled', false), api.streamStatus()]).then(([value, info]) => {
      if (!active) return;
      setEnabled(Boolean(value));
      setInstalled(Boolean(info?.installed));
      setDownloadBytes(info?.download_bytes || 0);
    }).catch(error => { if (active) setStatus(error.message || String(error)); });
    const dispose = api.onStreamDownloadProgress((_, progress) => {
      if (active && progress.stage === 'downloading') setStatus(`下載中… ${Math.round(progress.progress || 0)}%`);
    });
    return () => { active = false; dispose(); };
  }, [api]);
  if (api?.runtime !== 'tauri' || typeof api.streamStatus !== 'function') return null;
  const download = async () => {
    setBusy(true); setStatus('正在下載並驗證串流模型…');
    try {
      const result = await api.streamDownload();
      if (!result.success) throw new Error(result.error || '串流模型下載失敗');
      setInstalled(Boolean(result.installed));
      setStatus('串流模型已就緒。');
    } catch (error) { setStatus(error.message || String(error)); }
    finally { setBusy(false); }
  };
  const toggle = async checked => {
    setEnabled(checked);
    try { await api.setSetting('streaming_enabled', checked); }
    catch (error) { setEnabled(!checked); setStatus(error.message || String(error)); }
  };
  return <section className="rounded-lg border p-5 space-y-4 text-foreground">
    <h2 className="text-lg font-semibold">即時串流辨識</h2>
    <p className="text-sm text-muted-foreground">錄音時即時顯示辨識草稿，停止後以引擎的最終結果為準。完全在本機執行；中英雙語，標點在停止後補上。</p>
    <p className="text-sm">模型：{installed ? '已安裝' : `尚未安裝（需下載約 ${Math.round(downloadBytes / MB)} MB 壓縮檔，安裝後約 237 MB）`}</p>
    <label className="flex items-center gap-2"><input disabled={busy || !installed} type="checkbox" checked={enabled && installed} onChange={e => toggle(e.target.checked)} />使用串流辨識</label>
    {!installed && <button disabled={busy} onClick={download} className="rounded bg-blue-600 text-white px-4 py-2 disabled:opacity-50">下載串流模型</button>}
    <p role="status" className="text-sm break-words">{status}</p>
  </section>;
}
