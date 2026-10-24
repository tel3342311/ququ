import React from 'react';
import {useInterfaceMode} from '../hooks/useInterfaceMode';

export default function InterfaceSettings() {
  const {mode,error,saving,changeMode}=useInterfaceMode();
  return <section className="rounded-lg border p-5 space-y-3 text-foreground" aria-labelledby="interface-heading">
    <h2 id="interface-heading" className="text-lg font-semibold">界面模式</h2>
    <p className="text-sm text-muted-foreground">两种界面共用快捷键、模型和历史。也可以从系统托盘快速切换；听写完成后才能切换。</p>
    <fieldset disabled={!mode||saving} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <legend className="sr-only">选择界面模式</legend>
      {[['classic','经典','保留麦克风按钮、状态和识别文字。'],['compact','极简','录音时显示小红点，不打断当前输入。']].map(([value,label,description])=><label key={value} className={`rounded-lg border p-4 cursor-pointer ${mode===value?'border-blue-500 bg-blue-500/10':''}`}>
        <span className="flex gap-2 items-center"><input type="radio" name="interface-mode" value={value} checked={mode===value} onChange={()=>changeMode(value)}/><strong>{label}</strong></span>
        <span className="block text-sm text-muted-foreground mt-2">{description}</span>
      </label>)}
    </fieldset>
    <p className="text-sm" role="status">{saving?'正在切换…':mode?'选择会自动保存，重启后继续使用。':'正在读取界面设置…'}</p>
    {error&&<p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
  </section>;
}
