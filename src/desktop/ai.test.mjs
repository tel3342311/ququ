import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_PROVIDER_GOOGLE,
  AI_PROVIDER_OPENAI,
  GOOGLE_AI_DEFAULT_BASE_URL,
  GOOGLE_AI_DEFAULT_MODEL,
  GOOGLE_AI_PREDEFINED_MODELS,
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_DEFAULT_MODEL,
  OPENAI_PREDEFINED_MODELS,
  applyProviderPreset,
  buildChatCompletionRequest,
  extractAIErrorMessage,
  inferAIProvider,
  isGoogleAIBaseUrl,
  isPredefinedModel,
  modelsForProvider,
  normalizeAIBaseUrl,
  normalizeLoadedAISettings,
  parseChatCompletionResponse,
  resolveAIConfig,
} from './ai.mjs';
import { finishDictation } from './dictation.mjs';

test('preserves existing OpenAI and DashScope saved settings unchanged when loading', () => {
  assert.deepEqual(normalizeLoadedAISettings({}), {
    ai_provider: AI_PROVIDER_OPENAI,
    ai_api_key: '',
    ai_base_url: OPENAI_DEFAULT_BASE_URL,
    ai_model: OPENAI_DEFAULT_MODEL,
    enable_ai_optimization: true,
  });

  const savedOpenAI = normalizeLoadedAISettings({
    ai_api_key: 'sk-openai-test',
    ai_base_url: 'https://api.openai.com/v1',
    ai_model: 'gpt-4o',
    enable_ai_optimization: false,
  });
  assert.deepEqual(savedOpenAI, {
    ai_provider: AI_PROVIDER_OPENAI,
    ai_api_key: 'sk-openai-test',
    ai_base_url: 'https://api.openai.com/v1',
    ai_model: 'gpt-4o',
    enable_ai_optimization: false,
  });
  assert.equal(isPredefinedModel(savedOpenAI.ai_model, savedOpenAI.ai_provider), true);

  const savedDashScope = normalizeLoadedAISettings({
    ai_api_key: 'sk-dashscope-test',
    ai_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ai_model: 'qwen3-30b-a3b-instruct-2507',
  });
  assert.equal(savedDashScope.ai_provider, AI_PROVIDER_OPENAI);
  assert.equal(savedDashScope.ai_base_url, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(savedDashScope.ai_model, 'qwen3-30b-a3b-instruct-2507');
});

test('recognizes Google AI settings by provider or base URL and normalizes trailing slashes', () => {
  assert.equal(isGoogleAIBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai'), true);
  assert.equal(isGoogleAIBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai/'), true);
  assert.equal(isGoogleAIBaseUrl('https://api.openai.com/v1'), false);

  assert.equal(
    inferAIProvider({ ai_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/' }),
    AI_PROVIDER_GOOGLE
  );
  assert.equal(
    inferAIProvider({ ai_provider: AI_PROVIDER_GOOGLE }),
    AI_PROVIDER_GOOGLE
  );
  assert.equal(
    normalizeAIBaseUrl('https://generativelanguage.googleapis.com/v1beta/openai///', AI_PROVIDER_GOOGLE),
    GOOGLE_AI_DEFAULT_BASE_URL
  );

  const loadedGoogle = normalizeLoadedAISettings({
    ai_provider: AI_PROVIDER_GOOGLE,
    ai_api_key: 'AIzaSyTestKey',
    ai_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    ai_model: 'gemini-2.5-flash',
  });
  assert.deepEqual(loadedGoogle, {
    ai_provider: AI_PROVIDER_GOOGLE,
    ai_api_key: 'AIzaSyTestKey',
    ai_base_url: GOOGLE_AI_DEFAULT_BASE_URL,
    ai_model: 'gemini-2.5-flash',
    enable_ai_optimization: true,
  });
  assert.equal(isPredefinedModel('gemini-2.5-flash', AI_PROVIDER_GOOGLE), true);
  assert.equal(isPredefinedModel('gemini-custom-experimental', AI_PROVIDER_GOOGLE), false);
});

test('switching between OpenAI-compatible and Google AI presets base URL and model list', () => {
  assert.deepEqual(modelsForProvider(AI_PROVIDER_GOOGLE), GOOGLE_AI_PREDEFINED_MODELS);
  assert.deepEqual(modelsForProvider(AI_PROVIDER_OPENAI), OPENAI_PREDEFINED_MODELS);

  const initial = {
    ai_provider: AI_PROVIDER_OPENAI,
    ai_api_key: 'AIzaSyTestKey',
    ai_base_url: OPENAI_DEFAULT_BASE_URL,
    ai_model: OPENAI_DEFAULT_MODEL,
    enable_ai_optimization: true,
  };

  const googlePreset = applyProviderPreset(initial, AI_PROVIDER_GOOGLE);
  assert.equal(googlePreset.ai_provider, AI_PROVIDER_GOOGLE);
  assert.equal(googlePreset.ai_base_url, GOOGLE_AI_DEFAULT_BASE_URL);
  assert.equal(googlePreset.ai_model, GOOGLE_AI_DEFAULT_MODEL);
  assert.equal(googlePreset.ai_api_key, 'AIzaSyTestKey');

  const withGeminiPro = { ...googlePreset, ai_model: 'gemini-2.5-pro' };
  assert.equal(applyProviderPreset(withGeminiPro, AI_PROVIDER_GOOGLE).ai_model, 'gemini-2.5-pro');

  const backToOpenAI = applyProviderPreset(withGeminiPro, AI_PROVIDER_OPENAI);
  assert.equal(backToOpenAI.ai_provider, AI_PROVIDER_OPENAI);
  assert.equal(backToOpenAI.ai_base_url, OPENAI_DEFAULT_BASE_URL);
  assert.equal(backToOpenAI.ai_model, OPENAI_DEFAULT_MODEL);
});

test('builds chat/completions request for Google AI and OpenAI and parses documented responses', () => {
  const googleReq = buildChatCompletionRequest(
    {
      ai_provider: AI_PROVIDER_GOOGLE,
      ai_api_key: '  AIzaSyDummyKey  ',
      ai_base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      ai_model: 'gemini-2.5-flash',
    },
    { prompt: '請回覆測試成功', test: true }
  );

  assert.equal(googleReq.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.deepEqual(googleReq.headers, {
    Authorization: 'Bearer AIzaSyDummyKey',
    'Content-Type': 'application/json',
  });
  assert.deepEqual(googleReq.body, {
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: '請回覆測試成功' }],
    temperature: 0.1,
    stream: false,
  });
  assert.equal('max_tokens' in googleReq.body, false, 'Google AI requests must not cap thinking+output tokens at 50');

  const openAIReq = buildChatCompletionRequest(
    {
      ai_provider: AI_PROVIDER_OPENAI,
      ai_api_key: 'sk-test',
      ai_base_url: 'https://api.openai.com/v1/',
      ai_model: 'gpt-4o-mini',
    },
    { prompt: '原始文字', test: false }
  );
  assert.equal(openAIReq.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openAIReq.body.max_tokens, 2000);

  // Documented Google AI OpenAI-compatible response shape
  const googleSuccessPayload = {
    id: 'chatcmpl-gemini-123',
    object: 'chat.completion',
    created: 1740000000,
    model: 'gemini-2.5-flash',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: '會議定在週四。\n',
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 42,
      completion_tokens: 6,
      total_tokens: 48,
    },
  };
  assert.deepEqual(parseChatCompletionResponse(googleSuccessPayload), {
    text: '會議定在週四。',
    usage: { prompt_tokens: 42, completion_tokens: 6, total_tokens: 48 },
    model: 'gemini-2.5-flash',
  });

  // Recorded Google AI OpenAI-compatible error response shape (JSON array)
  const googleErrorPayload = [
    {
      error: {
        code: 400,
        message: 'Please pass a valid API key',
        status: 'INVALID_ARGUMENT',
      },
    },
  ];
  assert.equal(extractAIErrorMessage(googleErrorPayload, 400), 'Please pass a valid API key');

  // OpenAI error response shape (JSON object)
  const openAIErrorPayload = {
    error: {
      message: 'Incorrect API key provided',
      type: 'invalid_request_error',
    },
  };
  assert.equal(extractAIErrorMessage(openAIErrorPayload, 401), 'Incorrect API key provided');
});

test('finishDictation optimizes transcribed text through Google AI configuration end to end', async () => {
  const requests = [];
  const saved = [];
  const pasted = [];
  const settings = resolveAIConfig({
    ai_provider: AI_PROVIDER_GOOGLE,
    ai_api_key: 'AIzaSyMockedKey',
    ai_base_url: GOOGLE_AI_DEFAULT_BASE_URL,
    ai_model: 'gemini-2.5-flash',
    enable_ai_optimization: true,
  });

  const api = {
    getSetting: async (key, fallback) => (key in settings ? settings[key] : fallback),
    getSpecialWords: async () => [],
    transcribeAudio: async () => ({
      success: true,
      text: '呃那個我我我覺得會議定在週三呃不對是週四',
      raw_text: '呃那個我我我覺得會議定在週三呃不對是週四',
    }),
    processText: async (text, mode) => {
      const req = buildChatCompletionRequest(settings, { prompt: `[${mode}] ${text}`, test: false });
      requests.push(req);
      const parsed = parseChatCompletionResponse({
        object: 'chat.completion',
        model: req.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '我覺得會議定在週四。',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 },
      });
      return { success: true, text: parsed.text, usage: parsed.usage, model: req.model };
    },
    saveTranscription: async row => {
      saved.push(row);
      return { lastInsertRowid: 1 };
    },
    pasteText: async text => {
      pasted.push(text);
      return { success: true };
    },
    copyText: async () => ({ success: true }),
  };

  const result = await finishDictation(api, new Uint8Array([1, 2, 3]));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(requests[0].body.model, 'gemini-2.5-flash');
  assert.equal(result.text, '我覺得會議定在週四。');
  assert.equal(saved[0].raw_text, '呃那個我我我覺得會議定在週三呃不對是週四');
  assert.equal(saved[0].processed_text, '我覺得會議定在週四。');
  assert.deepEqual(pasted, ['我覺得會議定在週四。']);
});
