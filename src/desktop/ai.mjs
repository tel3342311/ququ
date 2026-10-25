export const AI_PROVIDER_OPENAI = 'openai';
export const AI_PROVIDER_GOOGLE = 'google';

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const GOOGLE_AI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const ALIYUN_RECOMMENDED_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export const OPENAI_DEFAULT_MODEL = 'gpt-3.5-turbo';
export const GOOGLE_AI_DEFAULT_MODEL = 'gemini-2.5-flash';
export const ALIYUN_RECOMMENDED_MODEL = 'qwen3-30b-a3b-instruct-2507';

export const AI_PROVIDERS = [
  { value: AI_PROVIDER_OPENAI, label: 'OpenAI 相容' },
  { value: AI_PROVIDER_GOOGLE, label: 'Google AI (Gemini)' },
];

export const OPENAI_PREDEFINED_MODELS = [
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { value: 'qwen3-30b-a3b-instruct-2507', label: 'Qwen3-30B (推薦)' },
];

export const GOOGLE_AI_PREDEFINED_MODELS = [
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (推薦)' },
  { value: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
];

export function isGoogleAIBaseUrl(baseUrl) {
  return typeof baseUrl === 'string' && baseUrl.toLowerCase().includes('generativelanguage.googleapis.com');
}

export function inferAIProvider(settings = {}) {
  const rawBaseUrl = typeof settings.ai_base_url === 'string' ? settings.ai_base_url.trim() : '';
  if (isGoogleAIBaseUrl(rawBaseUrl)) {
    return AI_PROVIDER_GOOGLE;
  }
  if (settings.ai_provider === AI_PROVIDER_GOOGLE && !rawBaseUrl) {
    return AI_PROVIDER_GOOGLE;
  }
  if (settings.ai_provider === AI_PROVIDER_OPENAI) {
    return AI_PROVIDER_OPENAI;
  }
  if (settings.ai_provider === AI_PROVIDER_GOOGLE) {
    return AI_PROVIDER_GOOGLE;
  }
  const rawModel = typeof settings.ai_model === 'string' ? settings.ai_model.trim() : '';
  if (!rawBaseUrl && rawModel.toLowerCase().startsWith('gemini-')) {
    return AI_PROVIDER_GOOGLE;
  }
  return AI_PROVIDER_OPENAI;
}

export function defaultBaseUrlForProvider(provider) {
  return provider === AI_PROVIDER_GOOGLE ? GOOGLE_AI_DEFAULT_BASE_URL : OPENAI_DEFAULT_BASE_URL;
}

export function defaultModelForProvider(provider) {
  return provider === AI_PROVIDER_GOOGLE ? GOOGLE_AI_DEFAULT_MODEL : OPENAI_DEFAULT_MODEL;
}

export function normalizeAIBaseUrl(baseUrl, provider = AI_PROVIDER_OPENAI) {
  const trimmed = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
  return trimmed || defaultBaseUrlForProvider(provider);
}

export function modelsForProvider(provider) {
  return provider === AI_PROVIDER_GOOGLE ? GOOGLE_AI_PREDEFINED_MODELS : OPENAI_PREDEFINED_MODELS;
}

export function isPredefinedModel(model, provider = AI_PROVIDER_OPENAI) {
  return modelsForProvider(provider).some(item => item.value === model);
}

export function normalizeLoadedAISettings(allSettings = {}) {
  const provider = inferAIProvider(allSettings);
  return {
    ai_provider: provider,
    ai_api_key: typeof allSettings.ai_api_key === 'string' ? allSettings.ai_api_key : '',
    ai_base_url: normalizeAIBaseUrl(allSettings.ai_base_url, provider),
    ai_model: (typeof allSettings.ai_model === 'string' && allSettings.ai_model.trim()) || defaultModelForProvider(provider),
    enable_ai_optimization: allSettings.enable_ai_optimization !== false,
  };
}

export function applyProviderPreset(currentSettings = {}, nextProvider) {
  const provider = nextProvider === AI_PROVIDER_GOOGLE ? AI_PROVIDER_GOOGLE : AI_PROVIDER_OPENAI;
  if (provider === AI_PROVIDER_GOOGLE) {
    const keepModel = isPredefinedModel(currentSettings.ai_model, AI_PROVIDER_GOOGLE);
    return {
      ...currentSettings,
      ai_provider: AI_PROVIDER_GOOGLE,
      ai_base_url: GOOGLE_AI_DEFAULT_BASE_URL,
      ai_model: keepModel ? currentSettings.ai_model : GOOGLE_AI_DEFAULT_MODEL,
    };
  }
  const currentUrl = typeof currentSettings.ai_base_url === 'string' ? currentSettings.ai_base_url.trim() : '';
  const nextBaseUrl = !currentUrl || isGoogleAIBaseUrl(currentUrl) ? OPENAI_DEFAULT_BASE_URL : currentUrl.replace(/\/+$/, '');
  const keepModel = isPredefinedModel(currentSettings.ai_model, AI_PROVIDER_OPENAI);
  return {
    ...currentSettings,
    ai_provider: AI_PROVIDER_OPENAI,
    ai_base_url: nextBaseUrl,
    ai_model: keepModel ? currentSettings.ai_model : OPENAI_DEFAULT_MODEL,
  };
}

export function resolveAIConfig(raw = {}) {
  const provider = inferAIProvider(raw);
  const apiKey = typeof raw.ai_api_key === 'string' ? raw.ai_api_key.trim() : '';
  const baseUrl = normalizeAIBaseUrl(raw.ai_base_url, provider);
  const model = (typeof raw.ai_model === 'string' && raw.ai_model.trim()) || defaultModelForProvider(provider);
  return {
    ai_provider: provider,
    ai_api_key: apiKey,
    ai_base_url: baseUrl,
    ai_model: model,
    enable_ai_optimization: raw.enable_ai_optimization !== false,
  };
}

export function buildChatCompletionRequest(config, { prompt, test = false, temperature } = {}) {
  const resolved = resolveAIConfig(config);
  if (!resolved.ai_api_key) {
    throw new Error('請先在設定頁面設定 AI API 金鑰');
  }
  const isGoogle = resolved.ai_provider === AI_PROVIDER_GOOGLE || isGoogleAIBaseUrl(resolved.ai_base_url);
  const body = {
    model: resolved.ai_model,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: temperature ?? (test ? 0.1 : 0.3),
    stream: false,
  };
  if (!isGoogle) {
    body.max_tokens = test ? 50 : 2000;
  }
  return {
    url: `${resolved.ai_base_url}/chat/completions`,
    headers: {
      Authorization: `Bearer ${resolved.ai_api_key}`,
      'Content-Type': 'application/json',
    },
    body,
    provider: resolved.ai_provider,
    baseUrl: resolved.ai_base_url,
    model: resolved.ai_model,
  };
}

export function extractAIErrorMessage(errorData, status) {
  const candidate = Array.isArray(errorData) ? errorData[0] : errorData;
  if (candidate && typeof candidate === 'object') {
    if (typeof candidate.error === 'string' && candidate.error.trim()) {
      return candidate.error.trim();
    }
    if (candidate.error && typeof candidate.error.message === 'string' && candidate.error.message.trim()) {
      return candidate.error.message.trim();
    }
    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return candidate.message.trim();
    }
  }
  if (typeof errorData === 'string' && errorData.trim()) {
    return errorData.trim();
  }
  return status ? `API 請求失敗: ${status}` : 'API 請求失敗';
}

export function parseChatCompletionResponse(data) {
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) {
    throw new Error('API 回傳資料格式錯誤');
  }
  const rawContent = data.choices[0]?.message?.content;
  let text = '';
  if (typeof rawContent === 'string') {
    text = rawContent.trim();
  } else if (Array.isArray(rawContent)) {
    text = rawContent
      .map(part => (typeof part === 'string' ? part : part?.text || ''))
      .join('')
      .trim();
  }
  if (!text) {
    throw new Error('API 回傳資料格式錯誤');
  }
  return {
    text,
    usage: data.usage,
    model: data.model,
  };
}
