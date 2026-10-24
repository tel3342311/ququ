import React from 'react';
import {useInterfaceMode} from '../hooks/useInterfaceMode';

export default function InterfaceSettings() {
  const {mode,error,saving,changeMode}=useInterfaceMode();
  return <section className="rounded-lg border p-5 space-y-3 text-foreground" aria-labelledby="interface-heading">
    <h2 id="interface-heading" className="text-lg font-semibold">介面模式</h2>
    <p className="text-sm text-muted-foreground">兩種介面共用快速鍵、模型與歷史記錄。也可以從系統匣快速切換；聽寫完成後才能切換。</p>
    <fieldset disabled={!mode||saving} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <legend className="sr-only">選擇介面模式</legend>
      {[['classic','經典','保留麥克風按鈕、狀態與辨識文字。'],['compact','極簡','錄音時顯示小紅點，不打斷當前輸入。']].map(([value,label,description])=><label key={value} className={`rounded-lg border p-4 cursor-pointer ${mode===value?'border-blue-500 bg-blue-500/10':''}`}>
        <span className="flex gap-2 items-center"><input type="radio" name="interface-mode" value={value} checked={mode===value} onChange={()=>changeMode(value)}/><strong>{label}</strong></span>
        <span className="block text-sm text-muted-foreground mt-2">{description}</span>
      </label>)}
    </fieldset>
    <p className="text-sm" role="status">{saving?'正在切換…':mode?'選擇會自動儲存，重新啟動後繼續使用。':'正在讀取介面設定…'}</p>
    {error&&<p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
  </section>;
}
