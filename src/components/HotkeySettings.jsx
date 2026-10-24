import React, { useEffect, useState } from 'react';
import { createHotkeyCapture } from '../desktop/hotkey.mjs';

const message = error => error?.message || String(error);

export default function HotkeySettings() {
  const api = window.electronAPI;
  const native = api?.runtime === 'tauri';
  const [config, setConfig] = useState({ key: 'Control+Shift+Space', mode: 'toggle' });
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [armed, setArmed] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!native) return;
    let active = true;
    api.getHotkeyConfig().then(value => {
      if (!active) return;
      setConfig(value); setSaved(value);
    }).catch(reason => { if (active) setError(message(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, native]);

  useEffect(() => {
    if (!capturing || !native) return;
    let active = true;
    let listening = false;
    const capture = createHotkeyCapture();
    const finish = key => {
      if (!active || !key) return;
      active = false;
      if (key !== 'cancel') {
        setConfig(previous => ({ ...previous, key }));
        setStatus('快速鍵已擷取，點擊儲存後生效。');
      } else setStatus('已取消擷取。');
      setCapturing(false); setArmed(false);
    };
    const down = event => { event.preventDefault(); event.stopPropagation(); finish(capture.keydown(event)); };
    const up = event => { event.preventDefault(); event.stopPropagation(); finish(capture.keyup(event)); };
    const blur = () => finish('cancel');
    window.addEventListener('blur', blur);
    const started = Promise.resolve().then(() => api.beginHotkeyCapture()).then(result => {
      if (result?.success === false) throw new Error(result.error || '無法開始快速鍵擷取');
      if (!active) return;
      listening = true;
      window.addEventListener('keydown', down, true);
      window.addEventListener('keyup', up, true);
      setArmed(true);
    }).catch(reason => {
      if (active) { setError(message(reason)); setCapturing(false); setArmed(false); }
    });
    return () => {
      active = false;
      window.removeEventListener('blur', blur);
      if (listening) {
        window.removeEventListener('keydown', down, true);
        window.removeEventListener('keyup', up, true);
      }
      // Release after an outstanding begin resolves, including unmount/blur races.
      setReleasing(true);
      started.then(() => api.endHotkeyCapture()).then(result => {
        if (result?.success === false) throw new Error(result.error || '無法結束快速鍵擷取');
      }).catch(reason => {
        setError(message(reason));
      }).finally(() => setReleasing(false));
    };
  }, [api, native, capturing]);

  if (!native) return null;
  const save = async () => {
    setSaving(true); setError(''); setStatus('');
    try {
      const result = await api.setHotkeyConfig(config);
      if (!result?.success) throw new Error(result?.error || '快速鍵儲存失敗');
      setSaved({ ...config }); setStatus('快速鍵已儲存。');
    } catch (reason) { setError(message(reason)); }
    finally { setSaving(false); }
  };
  const disabled = loading || saving || capturing || releasing;
  const dirty = !saved || saved.key !== config.key || saved.mode !== config.mode;
  return <section className="rounded-lg border p-5 space-y-4">
    <h2 className="text-lg font-semibold">錄音快速鍵</h2>
    <p className="text-sm text-muted-foreground">支援左 / 右 Ctrl、Shift、Alt、Win，功能鍵或組合鍵。按 Esc 或切換視窗取消擷取。</p>
    <div className="flex flex-wrap items-center gap-3">
      <output className="rounded border px-3 py-2 font-mono" aria-label="錄音快速鍵">{config.key}</output>
      <button type="button" disabled={disabled} onClick={() => { setError(''); setStatus(''); setCapturing(true); }} className="rounded border px-4 py-2 disabled:opacity-50">{capturing ? armed ? '請按快速鍵…' : '正在準備…' : releasing ? '正在結束擷取…' : '重新擷取'}</button>
      {capturing && <button type="button" onClick={() => { setCapturing(false); setArmed(false); setStatus('已取消擷取。'); }} className="rounded border px-4 py-2">取消</button>}
    </div>
    <label className="block">錄音方式<select disabled={disabled} value={config.mode} onChange={event => { setConfig(previous => ({ ...previous, mode: event.target.value })); setStatus(''); }} className="mt-1 block w-full rounded border p-2 bg-background">
      <option value="toggle">按一下開始，再按一下停止</option>
      <option value="hold">按住錄音，放開停止</option>
    </select></label>
    <button type="button" disabled={disabled || !dirty} onClick={save} className="rounded bg-blue-600 text-white px-4 py-2 disabled:opacity-50">{saving ? '正在儲存…' : '儲存快速鍵'}</button>
    {error && <p role="alert" className="text-sm text-red-600 break-words">{error}</p>}
    <p role="status" className="text-sm">{status}</p>
  </section>;
}
