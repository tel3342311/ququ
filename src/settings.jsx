import './desktop/init.js';
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { toast, Toaster } from "sonner";
import { Settings, Save, Eye, EyeOff, X, Loader2, TestTube, CheckCircle, XCircle, Mic, Shield } from "lucide-react";
import { usePermissions } from "./hooks/usePermissions";
import PermissionCard from "./components/ui/permission-card";
import NativeSpeechSettings from './components/NativeSpeechSettings';
import StreamingSpeechSettings from './components/StreamingSpeechSettings';
import HotkeySettings from './components/HotkeySettings';
import InterfaceSettings from './components/InterfaceSettings';
import SpecialWordsSettings from './components/SpecialWordsSettings';
import {
  AI_PROVIDERS,
  AI_PROVIDER_GOOGLE,
  AI_PROVIDER_OPENAI,
  ALIYUN_RECOMMENDED_BASE_URL,
  ALIYUN_RECOMMENDED_MODEL,
  GOOGLE_AI_DEFAULT_BASE_URL,
  GOOGLE_AI_DEFAULT_MODEL,
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  applyProviderPreset,
  defaultBaseUrlForProvider,
  defaultModelForProvider,
  inferAIProvider,
  isGoogleAIBaseUrl,
  isPredefinedModel,
  modelsForProvider,
  normalizeLoadedAISettings,
  resolveAIConfig,
} from './desktop/ai.mjs';

const SettingsPage = () => {
  const [settings, setSettings] = useState({
    ai_provider: AI_PROVIDER_OPENAI,
    ai_api_key: "",
    ai_base_url: OPENAI_DEFAULT_BASE_URL,
    ai_model: OPENAI_DEFAULT_MODEL,
    enable_ai_optimization: true
  });
  
  const [customModel, setCustomModel] = useState(false);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  // 权限管理
  const showAlert = (alert) => {
    toast(alert.title, {
      description: alert.description,
      duration: 4000,
    });
  };

  const {
    micPermissionGranted,
    accessibilityPermissionGranted,
    requestMicPermission,
    testAccessibilityPermission,
  } = usePermissions(showAlert);

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      if (window.electronAPI) {
        const allSettings = await window.electronAPI.getAllSettings();
        const loadedSettings = normalizeLoadedAISettings(allSettings);
        setSettings(prev => ({ ...prev, ...loadedSettings }));
        setCustomModel(!isPredefinedModel(loadedSettings.ai_model, loadedSettings.ai_provider));
      }
    } catch (error) {
      console.error("加载设置失败:", error);
      toast.error("載入設定失敗");
    } finally {
      setLoading(false);
    }
  };

  // 保存设置
  const saveSettings = async () => {
    try {
      setSaving(true);
      if (window.electronAPI) {
        const resolved = resolveAIConfig(settings);
        setSettings(prev => ({ ...prev, ...resolved }));
        await window.electronAPI.setSetting('ai_provider', resolved.ai_provider);
        await window.electronAPI.setSetting('ai_api_key', resolved.ai_api_key);
        await window.electronAPI.setSetting('ai_base_url', resolved.ai_base_url);
        await window.electronAPI.setSetting('ai_model', resolved.ai_model);
        await window.electronAPI.setSetting('enable_ai_optimization', resolved.enable_ai_optimization);
        
        toast.success("設定儲存成功");
      }
    } catch (error) {
      console.error("保存设置失败:", error);
      toast.error("儲存設定失敗");
    } finally {
      setSaving(false);
    }
  };

  // 处理输入变化
  const handleInputChange = (key, value) => {
    setSettings(prev => {
      const next = {
        ...prev,
        [key]: value
      };
      if (key === 'ai_base_url' && isGoogleAIBaseUrl(value)) {
        next.ai_provider = AI_PROVIDER_GOOGLE;
      }
      return next;
    });
  };

  const handleProviderChange = (nextProvider) => {
    setSettings(prev => applyProviderPreset(prev, nextProvider));
    setCustomModel(false);
  };

  // 应用推荐配置
  const applyRecommendedConfig = () => {
    setSettings(prev => ({
      ...prev,
      ai_provider: AI_PROVIDER_OPENAI,
      ai_base_url: ALIYUN_RECOMMENDED_BASE_URL,
      ai_model: ALIYUN_RECOMMENDED_MODEL
    }));
    setCustomModel(true);
    toast.info("已套用阿里雲推薦設定");
  };

  // 重置为OpenAI配置
  const resetToOpenAI = () => {
    setSettings(prev => ({
      ...prev,
      ai_provider: AI_PROVIDER_OPENAI,
      ai_base_url: OPENAI_DEFAULT_BASE_URL,
      ai_model: OPENAI_DEFAULT_MODEL
    }));
    setCustomModel(false);
    toast.info("已重設為 OpenAI 設定");
  };

  // 套用 Google AI (Gemini) 配置
  const applyGoogleAIConfig = () => {
    setSettings(prev => applyProviderPreset(prev, AI_PROVIDER_GOOGLE));
    setCustomModel(false);
    toast.info("已套用 Google AI (Gemini) 設定");
  };

  // 测试AI配置
  const testAIConfiguration = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      
      // 验证当前输入的配置
      if (!settings.ai_api_key.trim()) {
        setTestResult({
          available: false,
          error: '請先輸入 API 金鑰',
          details: 'API 金鑰不能為空'
        });
        toast.error("設定不完整", {
          description: "請先輸入 API 金鑰"
        });
        return;
      }
      
      if (window.electronAPI) {
        // 使用当前页面的配置进行测试，而不是已保存的配置
        const resolved = resolveAIConfig(settings);
        const testConfig = {
          ai_provider: resolved.ai_provider,
          ai_api_key: resolved.ai_api_key,
          ai_base_url: resolved.ai_base_url,
          ai_model: resolved.ai_model
        };
        
        const result = await window.electronAPI.checkAIStatus(testConfig);
        setTestResult(result);
        
        if (result.available) {
          toast.success("AI 設定測試成功！", {
            description: `模型: ${result.model || '未知'} - 連線正常`
          });
        } else {
          toast.error("AI 設定測試失敗", {
            description: result.error || "未知錯誤"
          });
        }
      }
    } catch (error) {
      console.error("测试AI配置失败:", error);
      setTestResult({
        available: false,
        error: error.message || "測試失敗"
      });
      toast.error("測試失敗", {
        description: error.message || "未知錯誤"
      });
    } finally {
      setTesting(false);
    }
  };

  // 关闭窗口
  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.hideSettingsWindow();
    }
  };

  const currentProvider = inferAIProvider(settings);
  const providerModels = modelsForProvider(currentProvider);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="flex items-center space-x-3">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="text-gray-700 dark:text-gray-300">載入設定中...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-gradient-to-br from-slate-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 flex flex-col">
      {/* 标题栏 - 固定 */}
      <div className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-blue-600" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100 chinese-title">設定</h1>
          </div>
          <button
            onClick={handleClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>
      </div>

      {/* 主要内容 - 可滚动 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="max-w-2xl mx-auto p-6 pb-8">
          <div className="mb-6"><SpecialWordsSettings /></div>
          <div className="mb-6"><NativeSpeechSettings /></div>
          <div className="mb-6"><StreamingSpeechSettings /></div>
          <div className="mb-6"><HotkeySettings /></div>
          {window.electronAPI?.runtime==='tauri'&&<div className="mb-6"><InterfaceSettings /></div>}
          {/* 权限管理部分 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 mb-6">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  權限管理
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  測試與管理應用程式權限，確保麥克風與輔助使用功能正常運作。
                </p>
              </div>
              
              <div className="space-y-2">
                <PermissionCard
                  icon={Mic}
                  title="麥克風權限"
                  description="錄製語音所需的權限"
                  granted={micPermissionGranted}
                  onRequest={requestMicPermission}
                  buttonText="測試麥克風"
                />

                <PermissionCard
                  icon={Shield}
                  title="輔助使用權限"
                  description="自動貼上文字所需的權限"
                  granted={accessibilityPermissionGranted}
                  onRequest={testAccessibilityPermission}
                  buttonText="測試權限"
                />
              </div>
            </div>
          </div>

          {/* AI配置部分 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="p-6">
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title">
                  AI 設定
                </h2>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                 設定 AI 模型以最佳化並增強語音辨識結果。若 API Key 無效或未填寫，最佳化功能將自動停用。
               </p>
              </div>

             <div className="space-y-4">
               {/* AI优化开关 */}
               <div className="flex items-center justify-between pt-4">
                 <label htmlFor="ai-optimization-toggle" className="text-sm font-medium text-gray-800 dark:text-gray-200">
                   啟用 AI 文字最佳化
                 </label>
                 <button
                   type="button"
                   role="switch"
                   aria-checked={settings.enable_ai_optimization}
                   onClick={() => handleInputChange('enable_ai_optimization', !settings.enable_ai_optimization)}
                   className={`${
                     settings.enable_ai_optimization ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                   } relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                 >
                   <span
                     aria-hidden="true"
                     className={`${
                       settings.enable_ai_optimization ? 'translate-x-4' : 'translate-x-0'
                     } inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
                   />
                 </button>
               </div>

               {/* AI 服务提供商 */}
               <div>
                 <label htmlFor="ai-provider" className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                   AI 服務提供者
                 </label>
                 <select
                   id="ai-provider"
                   value={currentProvider}
                   onChange={(e) => handleProviderChange(e.target.value)}
                   className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                 >
                   {AI_PROVIDERS.map((provider) => (
                     <option key={provider.value} value={provider.value}>
                       {provider.label}
                     </option>
                   ))}
                 </select>
                 <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                   選擇 OpenAI 相容服務或 Google AI (Gemini)，將自動帶入對應的端點與模型清單
                 </p>
               </div>

               {/* API Key */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    API Key *
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? "text" : "password"}
                      value={settings.ai_api_key}
                      onChange={(e) => handleInputChange('ai_api_key', e.target.value)}
                      placeholder={currentProvider === AI_PROVIDER_GOOGLE ? "請輸入您的 Google AI (Gemini) API Key" : "請輸入您的 AI API Key"}
                      className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {currentProvider === AI_PROVIDER_GOOGLE
                      ? "用於 Google AI (Gemini) 文字最佳化功能的 API 金鑰（可於 Google AI Studio 取得）"
                      : "用於 AI 文字最佳化功能的 API 金鑰"}
                  </p>
                </div>

                {/* Base URL */}
                <div>
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                    API Base URL
                  </label>
                  <input
                    type="url"
                    value={settings.ai_base_url}
                    onChange={(e) => handleInputChange('ai_base_url', e.target.value)}
                    placeholder={defaultBaseUrlForProvider(currentProvider)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                  />
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {currentProvider === AI_PROVIDER_GOOGLE
                      ? `Google AI 相容端點網址（預設：${GOOGLE_AI_DEFAULT_BASE_URL}）`
                      : "AI 服務的 API 端點網址，支援相容 OpenAI 的 API"}
                  </p>
                </div>

                {/* Model */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                      AI 模型
                    </label>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={applyRecommendedConfig}
                        className="text-xs px-2 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                      >
                        阿里雲推薦
                      </button>
                      <button
                        type="button"
                        onClick={resetToOpenAI}
                        className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded hover:bg-blue-200 dark:hover:bg-blue-900/50 transition-colors"
                      >
                        OpenAI
                      </button>
                      <button
                        type="button"
                        onClick={applyGoogleAIConfig}
                        className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors"
                      >
                        Google AI
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="predefined-model"
                        name="model-type"
                        checked={!customModel}
                        onChange={() => {
                          setCustomModel(false);
                          if (!isPredefinedModel(settings.ai_model, currentProvider)) {
                            handleInputChange('ai_model', defaultModelForProvider(currentProvider));
                          }
                        }}
                        className="w-3 h-3 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <label htmlFor="predefined-model" className="text-xs text-gray-700 dark:text-gray-300">
                        預設模型
                      </label>
                    </div>
                    
                    {!customModel && (
                      <select
                        value={settings.ai_model}
                        onChange={(e) => handleInputChange('ai_model', e.target.value)}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      >
                        {providerModels.map((modelOption) => (
                          <option key={modelOption.value} value={modelOption.value}>
                            {modelOption.label}
                          </option>
                        ))}
                      </select>
                    )}
                    
                    <div className="flex items-center space-x-2">
                      <input
                        type="radio"
                        id="custom-model"
                        name="model-type"
                        checked={customModel}
                        onChange={() => setCustomModel(true)}
                        className="w-3 h-3 text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <label htmlFor="custom-model" className="text-xs text-gray-700 dark:text-gray-300">
                        自訂模型
                      </label>
                    </div>
                    
                    {customModel && (
                      <input
                        type="text"
                        value={settings.ai_model}
                        onChange={(e) => handleInputChange('ai_model', e.target.value)}
                        placeholder={currentProvider === AI_PROVIDER_GOOGLE
                          ? `輸入自訂模型名稱，例如：${GOOGLE_AI_DEFAULT_MODEL}`
                          : "輸入自訂模型名稱，例如：qwen3-30b-a3b-instruct-2507"}
                        className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                      />
                    )}
                  </div>
                  
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {currentProvider === AI_PROVIDER_GOOGLE
                      ? "選擇用於文字最佳化的 Google Gemini 模型，推薦使用 Gemini 2.5 Flash。"
                      : "選擇用於文字最佳化的 AI 模型。推薦使用阿里雲 Qwen3 模型獲得更好的中文處理效果。"}
                  </p>
                </div>
              </div>

              {/* 测试结果显示 */}
              {testResult && (
                <div className={`mt-4 p-3 rounded-lg border ${
                  testResult.available
                    ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                    : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
                }`}>
                  <div className="flex items-center space-x-2">
                    {testResult.available ? (
                      <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-600 dark:text-red-400" />
                    )}
                    <span className={`font-medium ${
                      testResult.available
                        ? 'text-green-800 dark:text-green-200'
                        : 'text-red-800 dark:text-red-200'
                    }`}>
                      {testResult.available ? 'AI 設定測試成功' : 'AI 設定測試失敗'}
                    </span>
                  </div>
                  
                  {testResult.available && (
                    <div className="mt-2 space-y-1">
                      {testResult.model && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          <strong>模型：</strong> {testResult.model}
                        </p>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          <strong>狀態：</strong> {testResult.details}
                        </p>
                      )}
                      {testResult.response && (
                        <p className="text-xs text-green-700 dark:text-green-300">
                          <strong>AI 回覆：</strong> {testResult.response}
                        </p>
                      )}
                      {testResult.usage && (
                        <p className="text-xs text-green-600 dark:text-green-400">
                          Token 使用量： {testResult.usage.total_tokens || 'N/A'}
                        </p>
                      )}
                    </div>
                  )}
                  
                  {!testResult.available && (
                    <div className="mt-2 space-y-1">
                      {testResult.error && (
                        <p className="text-xs text-red-700 dark:text-red-300">
                          <strong>錯誤：</strong> {testResult.error}
                        </p>
                      )}
                      {testResult.details && (
                        <p className="text-xs text-red-600 dark:text-red-400">
                          {testResult.details}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 操作按钮 */}
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
                <div className="flex flex-col">
                  <button
                    onClick={testAIConfiguration}
                    disabled={testing}
                    className="flex items-center space-x-2 px-3 py-1.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {testing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <TestTube className="w-3 h-3" />
                    )}
                    <span>{testing ? "測試中..." : "測試設定"}</span>
                  </button>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    測試目前編輯的設定（無需儲存）
                  </p>
                </div>
                
                <button
                  onClick={saveSettings}
                  disabled={saving || !settings.ai_api_key}
                  className="flex items-center space-x-2 px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  <span>{saving ? "儲存中..." : "儲存設定"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 其他设置部分 */}
          <div className="mt-4 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700">
            <div className="p-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 chinese-title mb-3">
                關於蛐蛐
              </h2>
              <div className="bg-gradient-to-r from-blue-50 to-green-50 dark:from-blue-900/20 dark:to-green-900/20 p-3 rounded-lg">
                <p className="text-xs text-gray-700 dark:text-gray-300 mb-1">
                  🎤 <strong>蛐蛐 (QuQu)</strong> - 基於 FunASR 與 AI 的中文語音轉文字應用程式
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400">
                  • 高精度中文語音辨識<br/>
                  • AI 智慧文字最佳化<br/>
                  • 即時語音處理<br/>
                  • 隱私保護設計
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 导出组件供App.jsx使用
export { SettingsPage };

// 如果是直接访问settings.html，则渲染应用
if (document.getElementById("settings-root")) {
  const root = ReactDOM.createRoot(document.getElementById("settings-root"));
  root.render(<SettingsPage />);
}
