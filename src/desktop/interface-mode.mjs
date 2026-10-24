const modes = new Set(['classic', 'compact']);

export function observeInterfaceMode(api, onMode, onError = () => {}) {
  let active = true;
  let revision = 0;
  const accept = mode => { if (active && modes.has(mode)) onMode(mode); };
  const release = api.onInterfaceModeChanged((_, payload) => {
    if (!active || !modes.has(payload?.mode)) return;
    revision++;
    accept(payload.mode);
  });
  const refresh = async () => {
    if (!active) return;
    const started = ++revision;
    try {
      const mode = await api.getInterfaceMode();
      if (active && started === revision) accept(mode);
    } catch (error) { if (active && started === revision) onError(error); }
  };
  if (release.ready) release.ready.then(refresh).catch(error=>{if(active)onError(error);});
  else refresh();
  return {
    refresh,
    dispose() { if (!active) return; active = false; release(); },
  };
}

export async function requestInterfaceMode(api, mode, phase = 'idle') {
  if (!modes.has(mode)) throw new Error('未知介面模式');
  if (phase !== 'idle') throw new Error('請先完成這次聽寫，再切換介面。');
  const result = await api.setInterfaceMode(mode);
  if (!result?.success) throw new Error(result?.error || '介面切換失敗');
}
