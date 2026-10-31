import React, { useState, useEffect, useCallback } from 'react';
import { BookA, Trash2, Plus, Loader2, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';

export default function SpecialWordsSettings() {
  const [words, setWords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newWord, setNewWord] = useState('');
  const [newReplacement, setNewReplacement] = useState('');
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const api = window.electronAPI;

  const loadWords = useCallback(async () => {
    if (!api?.getSpecialWords) {
      setLoading(false);
      return;
    }
    try {
      const list = await api.getSpecialWords();
      setWords(Array.isArray(list) ? list : []);
    } catch (error) {
      console.error('Failed to load special words:', error);
      toast.error('載入專有詞彙失敗');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    loadWords();
    if (api?.onSpecialWordsUpdate) {
      const dispose = api.onSpecialWordsUpdate(() => {
        loadWords();
      });
      return () => {
        if (typeof dispose === 'function') dispose();
      };
    }
  }, [api, loadWords]);

  const handleExport = async () => {
    if (!api?.exportSpecialWords) {
      toast.error('目前環境不支援匯出功能');
      return;
    }
    setExporting(true);
    try {
      const res = await api.exportSpecialWords();
      if (res?.canceled) {
        return;
      }
      if (res?.success) {
        toast.success(res.filePath ? `已匯出至：${res.filePath}` : '專有詞彙匯出成功');
      } else {
        toast.error('匯出失敗');
      }
    } catch (error) {
      console.error('Failed to export special words:', error);
      toast.error(error?.message || '匯出專有詞彙失敗');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!api?.importSpecialWords) {
      toast.error('目前環境不支援匯入功能');
      return;
    }
    setImporting(true);
    try {
      const res = await api.importSpecialWords();
      if (res?.canceled) {
        return;
      }
      if (res?.success && res.summary) {
        const { added = 0, skipped = 0, invalid = 0 } = res.summary;
        toast.success(`詞彙匯入完成：新增 ${added} 筆，略過 ${skipped} 筆，無效 ${invalid} 筆`);
        await loadWords();
      } else {
        toast.error('匯入失敗');
      }
    } catch (error) {
      console.error('Failed to import special words:', error);
      toast.error(error?.message || '匯入專有詞彙失敗');
    } finally {
      setImporting(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    const word = newWord.trim();
    if (!word) {
      toast.warning('請輸入詞彙');
      return;
    }

    const replacement = newReplacement.trim();
    setAdding(true);
    try {
      if (api?.saveSpecialWord) {
        await api.saveSpecialWord({
          word,
          replacement: replacement || undefined,
        });
        toast.success(replacement ? `已儲存替換詞組：${word} → ${replacement}` : `已新增專有詞彙：${word}`);
        setNewWord('');
        setNewReplacement('');
        await loadWords();
      }
    } catch (error) {
      console.error('Failed to add special word:', error);
      toast.error(error?.message || '新增專有詞彙失敗');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id, word) => {
    try {
      if (api?.deleteSpecialWord) {
        await api.deleteSpecialWord(id);
        toast.success(`已刪除：${word}`);
        setWords(prev => prev.filter(item => item.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete special word:', error);
      toast.error('刪除失敗');
    }
  };

  return (
    <section
      className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6"
      aria-labelledby="special-words-heading"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BookA className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h2 id="special-words-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
            專有詞彙
          </h2>
          <span className="px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 font-medium">
            {words.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || loading}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
            title="匯入詞彙（JSON 格式）"
            aria-label="匯入詞彙"
          >
            {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            匯入
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || loading}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-50 cursor-pointer"
            title="匯出詞彙為可攜式 JSON 檔案"
            aria-label="匯出詞彙"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            匯出
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 mb-5">
        儲存專有詞彙或修正詞組。在傳統模式聽寫結果中滑鼠選取文字即可快速加入。
      </p>

      {/* 新增詞彙表單 */}
      <form onSubmit={handleAdd} className="mb-5 p-3 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600/40 space-y-3">
        <div className="text-xs font-medium text-gray-700 dark:text-gray-300">新增詞彙或替換詞組</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="詞彙或辨識文字（例如 庫伯內提斯）"
            value={newWord}
            onChange={e => setNewWord(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
          <input
            type="text"
            placeholder="正確寫法（選填，例如 Kubernetes）"
            value={newReplacement}
            onChange={e => setNewReplacement(e.target.value)}
            className="w-full px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={adding || !newWord.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg disabled:opacity-50 transition-colors cursor-pointer"
          >
            {adding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            新增詞彙
          </button>
        </div>
      </form>

      {/* 詞彙列表 */}
      {loading ? (
        <div className="py-8 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400 gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          載入專有詞彙中…
        </div>
      ) : words.length === 0 ? (
        <div className="py-8 text-center text-xs text-gray-500 dark:text-gray-400">
          尚無專有詞彙。在聽寫結果中選取文字即可新增。
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/60 max-h-72 overflow-y-auto">
          {words.map(item => (
            <li key={item.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {item.replacement ? (
                  <span className="truncate">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{item.word}</span>
                    <span className="mx-1.5 text-gray-400 dark:text-gray-500">→</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">{item.replacement}</span>
                  </span>
                ) : (
                  <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{item.word}</span>
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    item.replacement
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}
                >
                  {item.replacement ? '替換' : '詞彙'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDelete(item.id, item.word)}
                className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                title="刪除"
                aria-label={`刪除 ${item.word}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
