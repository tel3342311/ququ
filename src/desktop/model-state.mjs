export function applyModelProgress(previous, progress) {
  const failed = progress.stage === 'error' || Boolean(progress.error);
  return {
    ...previous,
    downloadProgress: progress.overall_progress || progress.progress || 0,
    stage: previous.isReady ? 'ready' : failed ? 'error' : 'downloading',
    ...(failed ? {isDownloading:false, error:previous.isReady ? null : progress.error || '模型下載失敗'} : {}),
  };
}

export function applyModelReady(previous, data) {
  return {
    ...previous, isLoading:data.isLoading, isReady:data.isReady,
    isDownloading:false, modelsDownloaded:data.isReady || previous.modelsDownloaded,
    error:data.isReady ? null : previous.error,
    progress:data.progress || previous.progress, stage:data.isReady ? 'ready' : 'loading',
  };
}

export function languagesForEngine(engine) {
  if (engine === 'paraformer') return ['zh', 'en'];
  if (engine === 'tea_asr') return ['zh'];
  return ['zh', 'auto', 'yue', 'en', 'ja', 'ko'];
}
