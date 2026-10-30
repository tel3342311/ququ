import React from 'react';
import { Mic, Square, History, Settings, Minimize2, Copy, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useCompactDictation } from '../hooks/useCompactDictation';
import { useInterfaceMode } from '../hooks/useInterfaceMode';
import CompactDictation from './CompactDictation';
import EntityTranscript from './EntityTranscript';
import EntityCorrectionPopover from './EntityCorrectionPopover';
import EntityDock from './EntityDock';

export default function NativeDictation() {
  // Keep this controller mounted when changing only the visible interface.
  const dictation = useCompactDictation();
  const { mode, error, saving, changeMode } = useInterfaceMode();
  const [notice, setNotice] = React.useState('');
  const sentenceRef = React.useRef(null);
  const api = window.electronAPI;

  const [specialWords, setSpecialWords] = React.useState([]);
  const [correctionState, setCorrectionState] = React.useState({
    isOpen: false,
    word: '',
    initialReplacement: '',
    isEditing: false,
    isSaving: false,
  });

  const run = async operation => {
    try {
      await operation();
    } catch (reason) {
      setNotice(reason.message || String(reason));
    }
  };

  const loadSpecialWords = React.useCallback(async () => {
    if (!api?.getSpecialWords) return;
    try {
      const list = await api.getSpecialWords();
      setSpecialWords(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load special words:', err);
    }
  }, [api]);

  React.useEffect(() => {
    loadSpecialWords();
    if (api?.onSpecialWordsUpdate) {
      const dispose = api.onSpecialWordsUpdate(() => {
        loadSpecialWords();
      });
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    }
  }, [api, loadSpecialWords]);

  const handleWordClick = ({ word, replacement, isSpecial }) => {
    setCorrectionState({
      isOpen: true,
      word: word || '',
      initialReplacement: replacement || '',
      isEditing: Boolean(isSpecial),
      isSaving: false,
    });
  };

  const handleAddClick = () => {
    setCorrectionState({
      isOpen: true,
      word: '',
      initialReplacement: '',
      isEditing: false,
      isSaving: false,
    });
  };

  const handleEditWord = (item) => {
    setCorrectionState({
      isOpen: true,
      word: item.word,
      initialReplacement: item.replacement || '',
      isEditing: true,
      isSaving: false,
    });
  };

  const handleSaveCorrection = async ({ word, replacement }) => {
    setCorrectionState(prev => ({ ...prev, isSaving: true }));
    try {
      if (api?.saveSpecialWord) {
        await api.saveSpecialWord({
          word,
          replacement,
        });
      }
      if (replacement) {
        toast.success(`已儲存替換詞組：${word} → ${replacement}`);
        dictation.updateResultText(prev => (prev ? prev.replaceAll(word, replacement) : prev));
      } else if (correctionState.isEditing && correctionState.initialReplacement) {
        toast.success(`已更新為純專有詞彙：${word}`);
      } else {
        toast.success(`已新增專有詞彙：${word}`);
      }
      await loadSpecialWords();
      setCorrectionState({ isOpen: false, word: '', initialReplacement: '', isEditing: false, isSaving: false });
    } catch (err) {
      console.error('Failed to save special word:', err);
      toast.error(err?.message || '儲存專有詞彙失敗');
      setCorrectionState(prev => ({ ...prev, isSaving: false }));
    }
  };

  const handleDeleteWord = async (id, word) => {
    try {
      if (api?.deleteSpecialWord) {
        await api.deleteSpecialWord(id);
      }
      toast.success(`已刪除專有詞彙：${word}`);
      setSpecialWords(prev => prev.filter(w => w.id !== id));
      if (correctionState.isOpen && correctionState.word === word) {
        setCorrectionState({ isOpen: false, word: '', initialReplacement: '', isEditing: false, isSaving: false });
      }
    } catch (err) {
      console.error('Failed to delete special word:', err);
      toast.error('刪除失敗');
    }
  };

  if (!mode) return <div className="p-4 text-foreground" role="status">{error || '正在載入介面…'}</div>;
  if (mode === 'compact') return <CompactDictation isRecording={dictation.isRecording} />;
  const { phase, result, model } = dictation;
  const busy = phase !== 'idle', recording = phase === 'recording';
  const labels = { starting: '正在準備麥克風…', recording: '正在錄音，再次點擊停止', processing: '正在辨識語音…', optimizing: 'AI 正在最佳化文字…' };
  const status = labels[phase] || (!model.isReady ? (model.error || '模型準備中，請稍候…') : '點擊麥克風或按已設定的快速鍵開始錄音');

  return (
    <main className="native-classic text-foreground">
      <header className="flex items-center justify-between gap-3 mb-8 draggable">
        <h1 className="text-3xl font-bold chinese-title">蛐蛐</h1>
        <div className="flex gap-1 non-draggable">
          <button type="button" className="classic-tool" disabled={busy || saving} title="收合至極簡" aria-label="收合至極簡" onClick={() => changeMode('compact', phase)}><Minimize2 size={19} /></button>
          <button type="button" className="classic-tool" title="歷史記錄" aria-label="歷史記錄" onClick={() => run(() => api.openHistoryWindow())}><History size={20} /></button>
          <button type="button" className="classic-tool" title="設定" aria-label="設定" onClick={() => run(() => api.openSettingsWindow())}><Settings size={20} /></button>
          <button type="button" className="classic-tool" title="收合至系統匣" aria-label="收合至系統匣" onClick={() => run(() => api.hideWindow())}><X size={19} /></button>
        </div>
      </header>

      <section className="text-center mb-8">
        <button
          type="button"
          className={`classic-mic ${recording ? 'is-recording' : ''}`}
          disabled={['starting', 'processing', 'optimizing'].includes(phase) || !model.isReady}
          aria-label={recording ? '停止錄音' : '開始錄音'}
          onClick={() => dictation.dispatch('toggle')}
        >
          {['starting', 'processing', 'optimizing'].includes(phase) ? <Loader2 className="animate-spin" size={24} /> : recording ? <Square size={23} /> : <Mic size={25} />}
        </button>
        <p className="mt-4 text-sm text-muted-foreground status-text" role="status">{status}</p>
        {busy && <button type="button" className="text-sm mt-3 underline text-muted-foreground" onClick={() => dictation.dispatch('cancel')}>取消聽寫</button>}
        {!model.isReady && <button type="button" className="text-sm mt-3 underline" onClick={() => run(() => api.openSettingsWindow())}>開啟模型設定</button>}
      </section>

      {(result || specialWords.length > 0) && (
        <section className="rounded-lg border bg-secondary/70 p-4 chinese-content relative" aria-label="最近一次聽寫與專有詞彙">
          {result && (
            <>
              <div className="flex justify-between items-center gap-2">
                <h2 className="text-xs text-muted-foreground">最近一次聽寫</h2>
                <button
                  type="button"
                  aria-label="複製辨識文字"
                  className="classic-tool"
                  onClick={() => run(async () => {
                    await api.copyText(result.text);
                    setNotice('文字已複製。');
                  })}
                >
                  <Copy size={16} />
                </button>
              </div>

              <EntityTranscript
                text={result.text}
                specialWords={specialWords}
                onWordClick={handleWordClick}
                paragraphRef={sentenceRef}
              />

              {result.rawText && result.rawText !== result.text && (
                <details className="mt-3 text-sm text-muted-foreground">
                  <summary>原始辨識文字</summary>
                  <p className="whitespace-pre-wrap mt-2">{result.rawText}</p>
                </details>
              )}
            </>
          )}

          <EntityCorrectionPopover
            isOpen={correctionState.isOpen}
            word={correctionState.word}
            initialReplacement={correctionState.initialReplacement}
            isEditing={correctionState.isEditing}
            onSave={handleSaveCorrection}
            onClose={() => setCorrectionState(prev => ({ ...prev, isOpen: false }))}
            isSaving={correctionState.isSaving}
          />

          <EntityDock
            words={specialWords}
            onAddClick={handleAddClick}
            onEditWord={handleEditWord}
            onDeleteWord={handleDeleteWord}
            activeWord={correctionState.isOpen ? correctionState.word : ''}
          />
        </section>
      )}

      {(error || dictation.error || notice) && (
        <p className="mt-4 text-sm break-words text-muted-foreground" role="alert">
          {error || dictation.error || notice}
        </p>
      )}
    </main>
  );
}
