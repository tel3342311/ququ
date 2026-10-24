import { useState, useCallback } from 'react';

/**
 * 文本处理Hook
 * 使用可配置的AI模型进行文本处理
 */
export const useTextProcessing = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);

  // 根据文本长度自动选择处理模式
  const determineProcessingMode = useCallback((text, userMode = 'auto') => {
    if (userMode !== 'auto') {
      return userMode;
    }

    const textLength = text.trim().length;
    const wordCount = text.trim().split(/\s+/).length;

    // 长文本阈值：超过150字符或30个词
    if (textLength > 150 || wordCount > 30) {
      return 'optimize_long';
    } else {
      return 'optimize';
    }
  }, []);

  // 处理并保存转录的函数
  const handleTranscription = useCallback(async (transcriptionData, useAI) => {
    const { raw_text, duration, file_size } = transcriptionData;

    if (!raw_text || raw_text.trim().length === 0) {
      setError('轉錄文字不能為空');
      return null;
    }

    setIsProcessing(true);
    setError(null);

    let processed_text = null;
    let finalData = { ...transcriptionData, text: raw_text };

    if (useAI) {
      try {
        const actualMode = determineProcessingMode(raw_text, 'auto');
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log('info', '开始AI文本优化:', {
            text: raw_text.substring(0, 50) + '...',
            mode: actualMode,
          });
        }
        
        const result = await window.electronAPI.processText(raw_text, actualMode);

        if (result && result.success) {
          processed_text = result.text;
          finalData.processed_text = processed_text;
          // 如果AI优化后的文本与原始文本不同，则将优化后的文本作为主文本
          if (processed_text && processed_text.trim() !== raw_text.trim()) {
            finalData.text = processed_text;
          }
          if (window.electronAPI && window.electronAPI.log) {
            window.electronAPI.log('info', 'AI文本优化成功', { processed_text: processed_text.substring(0, 50) + '...' });
          }
        } else {
          if (window.electronAPI && window.electronAPI.log) {
            window.electronAPI.log('error', 'AI文本优化失败:', result);
          }
          setError(result?.error || 'AI 文字最佳化失敗');
        }
      } catch (err) {
        const errorMessage = err.message || 'AI 處理過程中發生未知錯誤';
        setError(errorMessage);
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log('error', 'AI文本优化捕获到错误:', err);
        }
      }
    }

    try {
      if (window.electronAPI) {
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log('info', '准备保存转录数据:', finalData);
        }
        const savedResult = await window.electronAPI.saveTranscription(finalData);
        if (window.electronAPI && window.electronAPI.log) {
          window.electronAPI.log('info', '转录数据保存成功:', savedResult);
        }
        return { ...finalData, id: savedResult.lastInsertRowid };
      }
    } catch (err) {
      const errorMessage = err.message || '儲存轉錄資料時發生未知錯誤';
      setError(errorMessage);
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '保存转录数据失败:', err);
      }
      return null;
    } finally {
      setIsProcessing(false);
    }
  }, [determineProcessingMode]);

  // 直接调用AI API
  const callAIAPI = useCallback(async (text, mode) => {
    // 优先从Electron API获取设置，然后是localStorage，最后是环境变量
    let apiKey, baseUrl, model;
    
    if (window.electronAPI) {
      try {
        apiKey = await window.electronAPI.getSetting('ai_api_key');
        baseUrl = await window.electronAPI.getSetting('ai_base_url') || 'https://api.openai.com/v1';
        model = await window.electronAPI.getSetting('ai_model') || 'gpt-3.5-turbo';
      } catch (error) {
        // 如果获取设置失败，回退到localStorage
        apiKey = localStorage.getItem('ai_api_key');
        baseUrl = localStorage.getItem('ai_base_url') || 'https://api.openai.com/v1';
        model = localStorage.getItem('ai_model') || 'gpt-3.5-turbo';
      }
    } else {
      // Web环境下使用localStorage
      apiKey = localStorage.getItem('ai_api_key');
      baseUrl = localStorage.getItem('ai_base_url') || 'https://api.openai.com/v1';
      model = localStorage.getItem('ai_model') || 'gpt-3.5-turbo';
    }
    
    if (!apiKey) {
      throw new Error('請先在設定頁面設定 AI API 金鑰');
    }

    const prompts = {
      format: `請將以下語音辨識文字進行格式化，加入適當的段落分隔和標點符號，使其更易閱讀：\n\n${text}`,
      correct: `請修正以下文字中的文法錯誤、錯別字和語音辨識錯誤，保持原意不變：\n\n${text}`,
      optimize: `# 角色與目標
你是一個專業的語音轉錄文字最佳化助手，任務是對由 ASR（自動語音辨識）產生的初步文字進行精細、最小幅度的潤飾。你的核心目標是去除言語組織過程中的干擾性雜音，同時 100% 保留說話者的原始意圖、個人風格和口語習慣。

# 核心原則
- **最小化修改**：只處理明確的、非內容性的言語錯誤。
- **保留原貌**：最大限度地保留使用者的原始用詞、句式和語氣。
- **可讀性優先**：在不改變原意的前提下，提升文字的流暢度與可讀性。
- **歧異時保守**：當不確定一個詞或一句話是否需要修改時，必須選擇保持原樣。

# 明確的最佳化指令 (Do's)
1.  **修正明顯的拼寫和語法錯誤**：修正同音錯字、標點誤用，以及基礎的文法搭配錯誤（如主謂不一致）。
2.  **移除無意義的贅字與填充詞**：刪除如「呃」、「嗯」、「啊這」、「那個」、「然後那個」、「就是說」等在思考或停頓時使用、不承載實際資訊的詞語。
3.  **處理重複與結巴**：合併無意義的重複詞語。
    -   例子 1: 「我我我覺得」 -> 「我覺得」
    -   例子 2: 「這個這個方案」 -> 「這個方案」
4.  **整合自我修正**：當使用者明確表達了修正意圖時，保留修正後的最終內容，並移除被修正的錯誤部分。
    -   例子 1: 「會議定在週三，呃不對，是週四」 -> 「會議定在週四」
    -   例子 2: 「他的名字是小明，喔我想起來了，是小強」 -> 「他的名字是小強」

# 嚴格的禁止事項 (Don'ts)
1.  **禁止風格轉換**：絕不能將口語化的表達（如「錄個影」、「蠻不錯」）替換為更書面化的詞語（如「錄製影片」、「非常優秀」）。
2.  **禁止替換用詞**：除非是明顯的錯別字，否則不能改變使用者的任何用詞選擇。
3.  **禁止改變句式**：不能為了「最佳化」而重組使用者的句子結構，例如將主動句改為被動句。
4.  **禁止增刪情感或語氣詞**：必須保留所有表達情感和語氣的詞，如「啊」、「呀」、「呢」、「吧」、「嘛」、「喔」、「哦」等。注意區分它們和第 2 條指令中提到的「無意義填充詞」。
5.  **禁止主觀臆斷**：不能添加任何原始文字中不存在的資訊，或基於猜測去「完善」句子。

原始文字：
\`\`\`
${text}
\`\`\`

直接回傳最佳化後的文字，不要包含任何解釋、前言或總結。`,
      optimize_long: `# 角色與目標
你是一個專業的長文字整理助手，專門處理語音轉錄的長段內容。你的任務是清理口語化的思考過程，並對內容進行邏輯分段，讓文字更加清晰易讀。

# 處理重點
這是一段較長的語音轉錄內容，通常包含完整的思考過程。你需要：

## 1. 清理口語化的思考過程
- **去除思考痕跡**：刪除「然後」、「就是說」、「其實」、「比如說」、「怎麼說呢」、「應該是」等思考過程中的冗餘表達
- **處理話題跳轉**：整理「對了」、「還有」、「另外」等突然轉換話題的表達
- **清理重複表述**：去除同一觀點的多次重複表達，保留最清晰的一次
- **整合修正表達**：當有「不對，我的意思是」、「更準確地說」等自我修正時，保留最終的正確表達

## 2. 智慧分段
- **辨識邏輯轉折點**：在話題轉換、觀點變化、舉例說明等處進行分段
- **保持邏輯完整性**：確保每段都有完整的邏輯表達
- **適度分段**：避免過短或過長的段落，保持閱讀節奏

## 3. 保持原意與自然性
- **不改變表達風格**：保持原有的用詞習慣和表達方式
- **不添加新內容**：絕不添加原文中沒有的資訊
- **保留重要細節**：確保例子、數據、具體描述都得到保留

原始文字：
\`\`\`
${text}
\`\`\`

請直接回傳清理後並分段的文字，不要包含任何解釋或說明。`,
      summarize: `請總結以下文字的主要內容，擷取關鍵資訊：\n\n${text}`,
      asr_enhance: `請對以下語音辨識原始文字進行謹慎最佳化，重點是修正而非改寫：

**最佳化原則（依重要性排序）：**
1. **嚴格保持原意和語意不變** - 這是最重要的原則
2. 修正明顯的語音辨識錯誤（如同音字錯誤：晴/情、到/道等）
3. 加入必要的標點符號，但不改變句子結構
4. 保留原文的語言風格（包括古詩詞、方言、口語等）
5. 如果是詩詞、成語、俗語等固定表達，請保持原樣

**特別注意：**
- 對於可能是詩詞、成語、俗語的內容，優先保持原有表達
- 同音字替換時要考慮上下文語意
- 寧可保守處理，也不要過度修改

原始文字：
${text}

請直接回傳最佳化後的文字，不需要解釋過程。`
    };

    // baseUrl和model已经在上面获取了

    const requestData = {
      model: model,
      messages: [
        {
          role: 'user',
          content: prompts[mode] || prompts.optimize
        }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      stream: false
    };

    if (window.electronAPI && window.electronAPI.log) {
      window.electronAPI.log('info', '前端AI文本处理请求:', {
        baseUrl,
        model,
        mode,
        inputText: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        requestData
      });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestData)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '前端AI API请求失败:', {
          status: response.status,
          statusText: response.statusText,
          errorData
        });
      }
      throw new Error(errorData.error?.message || `API 請求失敗: ${response.status}`);
    }

    const data = await response.json();
    
    if (window.electronAPI && window.electronAPI.log) {
      window.electronAPI.log('info', '前端AI文本处理响应:', {
        status: response.status,
        data: data,
        usage: data.usage
      });
    }
    
    if (data.choices && data.choices.length > 0) {
      const result = {
        success: true,
        text: data.choices[0].message.content.trim(),
        usage: data.usage
      };
      
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('info', '前端AI文本处理结果:', {
          originalText: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          optimizedText: result.text.substring(0, 100) + (result.text.length > 100 ? '...' : ''),
          usage: result.usage
        });
      }
      
      return result;
    } else {
      if (window.electronAPI && window.electronAPI.log) {
        window.electronAPI.log('error', '前端AI API返回数据格式错误:', data);
      }
      throw new Error('API 回傳資料格式錯誤');
    }
  }, []);

  return {
    handleTranscription,
    isProcessing,
    error
  };
};