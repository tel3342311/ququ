const { ipcMain } = require("electron");

class IPCHandlers {
  constructor(managers) {
    this.environmentManager = managers.environmentManager;
    this.databaseManager = managers.databaseManager;
    this.clipboardManager = managers.clipboardManager;
    this.funasrManager = managers.funasrManager;
    this.windowManager = managers.windowManager;
    this.hotkeyManager = managers.hotkeyManager;
    this.logger = managers.logger; // 添加logger引用
    
    // 跟踪F2热键注册状态
    this.f2RegisteredSenders = new Set();
    
    this.setupHandlers();
  }

  setupHandlers() {
    // 环境和配置相关
    ipcMain.handle("get-config", () => {
      return this.environmentManager.exportConfig();
    });

    ipcMain.handle("validate-environment", () => {
      return this.environmentManager.validateEnvironment();
    });

    // 录音相关
    ipcMain.handle("start-recording", async () => {
      // TODO: 实现录音开始功能
      return { success: true };
    });

    ipcMain.handle("stop-recording", async () => {
      // TODO: 实现录音停止功能
      return { success: true };
    });

    // Python 和 FunASR 相关
    ipcMain.handle("check-python", async () => {
      return await this.funasrManager.checkPythonInstallation();
    });

    ipcMain.handle("install-python", async (event, progressCallback) => {
      return await this.funasrManager.installPython((progress) => {
        event.sender.send("python-install-progress", progress);
      });
    });

    ipcMain.handle("check-funasr", async () => {
      return await this.funasrManager.checkFunASRInstallation();
    });

    ipcMain.handle("check-funasr-status", async () => {
      const status = await this.funasrManager.checkStatus();
      
      // 添加模型初始化状态信息
      return {
        ...status,
        models_initialized: this.funasrManager.modelsInitialized,
        server_ready: this.funasrManager.serverReady,
        is_initializing: this.funasrManager.initializationPromise !== null
      };
    });

    ipcMain.handle("install-funasr", async (event) => {
      return await this.funasrManager.installFunASR((progress) => {
        event.sender.send("funasr-install-progress", progress);
      });
    });

    ipcMain.handle("funasr-status", async () => {
      return await this.funasrManager.checkStatus();
    });

    // 模型文件管理
    ipcMain.handle("check-model-files", async () => {
      return await this.funasrManager.checkModelFiles();
    });

    ipcMain.handle("get-download-progress", async () => {
      return await this.funasrManager.getDownloadProgress();
    });

    ipcMain.handle("download-models", async (event) => {
      return await this.funasrManager.downloadModels((progress) => {
        event.sender.send("model-download-progress", progress);
      });
    });

    // AI文本处理
    ipcMain.handle("process-text", async (event, text, mode = 'optimize') => {
      return await this.processTextWithAI(text, mode);
    });

    ipcMain.handle("check-ai-status", async (event, testConfig = null) => {
      return await this.checkAIStatus(testConfig);
    });

    // 音频转录相关
    ipcMain.handle("transcribe-audio", async (event, audioData, options) => {
      return await this.funasrManager.transcribeAudio(audioData, options);
    });

    // 数据库相关
    ipcMain.handle("save-transcription", (event, data) => {
      return this.databaseManager.saveTranscription(data);
    });

    ipcMain.handle("get-transcriptions", (event, limit, offset) => {
      return this.databaseManager.getTranscriptions(limit, offset);
    });

    ipcMain.handle("get-transcription", (event, id) => {
      return this.databaseManager.getTranscriptionById(id);
    });

    ipcMain.handle("delete-transcription", (event, id) => {
      return this.databaseManager.deleteTranscription(id);
    });

    ipcMain.handle("search-transcriptions", (event, query, limit) => {
      return this.databaseManager.searchTranscriptions(query, limit);
    });

    ipcMain.handle("get-transcription-stats", () => {
      return this.databaseManager.getTranscriptionStats();
    });

    ipcMain.handle("clear-all-transcriptions", () => {
      return this.databaseManager.clearAllTranscriptions();
    });

    // 设置相关
    ipcMain.handle("get-setting", (event, key, defaultValue) => {
      return this.databaseManager.getSetting(key, defaultValue);
    });

    ipcMain.handle("set-setting", (event, key, value) => {
      return this.databaseManager.setSetting(key, value);
    });

    ipcMain.handle("get-all-settings", () => {
      return this.databaseManager.getAllSettings();
    });

    ipcMain.handle("get-settings", () => {
      return this.databaseManager.getAllSettings();
    });

    ipcMain.handle("save-setting", (event, key, value) => {
      return this.databaseManager.setSetting(key, value);
    });

    ipcMain.handle("reset-settings", () => {
      // TODO: 实现重置设置功能
      return this.databaseManager.resetSettings();
    });

    // 剪贴板相关
    ipcMain.handle("copy-text", async (event, text) => {
      try {
        return await this.clipboardManager.copyText(text);
      } catch (error) {
        this.logger.error("复制文本失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("paste-text", async (event, text) => {
      return this.clipboardManager.pasteText(text);
    });

    ipcMain.handle("insert-text-directly", async (event, text) => {
      try {
        return await this.clipboardManager.insertTextDirectly(text);
      } catch (error) {
        this.logger.error("直接插入文本失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("enable-macos-accessibility", async () => {
      try {
        if (process.platform === "darwin") {
          const result = await this.clipboardManager.enableMacOSAccessibility();
          return { success: result };
        }
        return { success: true, message: "非 macOS 平台，無需設定" };
      } catch (error) {
        this.logger.error("启用 macOS accessibility 失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("read-clipboard", async () => {
      try {
        const text = await this.clipboardManager.readClipboard();
        return { success: true, text };
      } catch (error) {
        this.logger.error("读取剪贴板失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("write-clipboard", async (event, text) => {
      try {
        return await this.clipboardManager.writeClipboard(text);
      } catch (error) {
        this.logger.error("写入剪贴板失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-clipboard-history", () => {
      // TODO: 实现剪贴板历史功能
      return [];
    });

    ipcMain.handle("clear-clipboard-history", () => {
      // TODO: 实现清除剪贴板历史功能
      return true;
    });

    // 窗口管理相关
    ipcMain.handle("hide-window", () => {
      if (this.windowManager.mainWindow) {
        this.windowManager.mainWindow.hide();
      }
      return true;
    });

    ipcMain.handle("show-window", () => {
      if (this.windowManager.mainWindow) {
        this.windowManager.mainWindow.show();
      }
      return true;
    });

    ipcMain.handle("minimize-window", () => {
      if (this.windowManager.mainWindow) {
        this.windowManager.mainWindow.minimize();
      }
      return true;
    });

    ipcMain.handle("close-window", () => {
      if (this.windowManager.mainWindow) {
        this.windowManager.mainWindow.close();
      }
      return true;
    });

    ipcMain.handle("show-control-panel", () => {
      this.windowManager.showControlPanel();
      return true;
    });

    ipcMain.handle("hide-control-panel", () => {
      this.windowManager.hideControlPanel();
      return true;
    });

    ipcMain.handle("open-control-panel", () => {
      this.windowManager.showControlPanel();
      return true;
    });

    ipcMain.handle("close-control-panel", () => {
      this.windowManager.hideControlPanel();
      return true;
    });

    ipcMain.handle("open-history-window", () => {
      this.windowManager.showHistoryWindow();
      return true;
    });

    ipcMain.handle("close-history-window", () => {
      this.windowManager.closeHistoryWindow();
      return true;
    });

    ipcMain.handle("hide-history-window", () => {
      this.windowManager.hideHistoryWindow();
      return true;
    });

    ipcMain.handle("open-settings-window", () => {
      this.windowManager.showSettingsWindow();
      return true;
    });

    ipcMain.handle("close-settings-window", () => {
      this.windowManager.closeSettingsWindow();
      return true;
    });

    ipcMain.handle("hide-settings-window", () => {
      this.windowManager.hideSettingsWindow();
      return true;
    });

    ipcMain.handle("close-app", () => {
      require("electron").app.quit();
    });

    // 热键管理 - 添加发送者跟踪机制
    this.hotkeyRegisteredSenders = new Set(); // 跟踪已注册热键的发送者
    
    ipcMain.handle("register-hotkey", (event, hotkey) => {
      try {
        if (this.hotkeyManager) {
          const senderId = event.sender.id;
          
          // 检查是否已经为这个发送者注册过热键
          if (this.hotkeyRegisteredSenders.has(senderId)) {
            this.logger.info(`发送者 ${senderId} 已注册过热键，跳过重复注册`);
            return { success: true };
          }
          
          const success = this.hotkeyManager.registerHotkey(hotkey, () => {
            // 只发送热键触发事件到主窗口，避免重复触发
            this.logger.info(`热键 ${hotkey} 被触发，发送事件到主窗口`);
            if (this.windowManager && this.windowManager.mainWindow && !this.windowManager.mainWindow.isDestroyed()) {
              this.windowManager.mainWindow.webContents.send("hotkey-triggered", { hotkey });
            }
          });
          
          if (success) {
            // 添加发送者到跟踪列表
            this.hotkeyRegisteredSenders.add(senderId);
            
            // 监听窗口关闭事件，清理注册记录
            event.sender.on('destroyed', () => {
              this.hotkeyRegisteredSenders.delete(senderId);
              this.logger.info(`清理发送者 ${senderId} 的热键注册记录`);
            });
            
            this.logger.info(`热键 ${hotkey} 注册成功，发送者: ${senderId}`);
          } else {
            this.logger.error(`热键 ${hotkey} 注册失败`);
          }
          
          return { success };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("注册热键失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("unregister-hotkey", (event, hotkey) => {
      try {
        if (this.hotkeyManager) {
          const success = this.hotkeyManager.unregisterHotkey(hotkey);
          return { success };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("注销热键失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-current-hotkey", () => {
      try {
        if (this.hotkeyManager) {
          const hotkeys = this.hotkeyManager.getRegisteredHotkeys();
          // 返回第一个非F2的热键，或默认热键
          const mainHotkey = hotkeys.find(key => key !== 'F2') || "CommandOrControl+Shift+Space";
          return mainHotkey;
        }
        return "CommandOrControl+Shift+Space";
      } catch (error) {
        this.logger.error("获取当前热键失败:", error);
        return "CommandOrControl+Shift+Space";
      }
    });

    // F2热键管理
    ipcMain.handle("register-f2-hotkey", (event) => {
      try {
        const senderId = event.sender.id;
        
        // 检查是否已经为这个发送者注册过F2热键
        if (this.f2RegisteredSenders.has(senderId)) {
          this.logger.info(`F2热键已为发送者 ${senderId} 注册过，跳过重复注册`);
          return { success: true };
        }
        
        if (this.hotkeyManager) {
          // 只有在没有任何发送者注册时才注册热键
          const isFirstRegistration = this.f2RegisteredSenders.size === 0;
          
          if (isFirstRegistration) {
            const success = this.hotkeyManager.registerF2DoubleClick((data) => {
              // 发送F2双击事件到所有注册的渲染进程
              this.logger.info("发送F2双击事件到渲染进程:", data);
              this.f2RegisteredSenders.forEach(id => {
                const window = require("electron").BrowserWindow.getAllWindows().find(w => w.webContents.id === id);
                if (window && !window.isDestroyed()) {
                  window.webContents.send("f2-double-click", data);
                }
              });
            });
            
            if (!success) {
              return { success: false, error: "F2热键注册失败" };
            }
          }
          
          // 添加发送者到跟踪列表
          this.f2RegisteredSenders.add(senderId);
          
          // 监听窗口关闭事件，清理注册记录
          event.sender.on('destroyed', () => {
            this.f2RegisteredSenders.delete(senderId);
            this.logger.info(`清理发送者 ${senderId} 的F2热键注册记录`);

            // 如果没有发送者了，注销热键
            if (this.f2RegisteredSenders.size === 0) {
              this.hotkeyManager.unregisterHotkey('F2');
              this.logger.info('所有发送者都已注销，注销F2热键');
            }
          });
          
          return { success: true };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("注册F2热键失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("unregister-f2-hotkey", (event) => {
      try {
        const senderId = event.sender.id;
        
        if (this.hotkeyManager && this.f2RegisteredSenders.has(senderId)) {
          this.f2RegisteredSenders.delete(senderId);
          
          // 如果没有其他发送者注册F2热键，则注销热键
          if (this.f2RegisteredSenders.size === 0) {
            const success = this.hotkeyManager.unregisterHotkey('F2');
            this.logger.info('所有发送者都已注销，注销F2热键');
            return { success };
          } else {
            this.logger.info(`发送者 ${senderId} 已注销，但还有其他发送者注册了F2热键`);
            return { success: true };
          }
        }
        return { success: false, error: "热键管理器未初始化或未注册" };
      } catch (error) {
        this.logger.error("注销F2热键失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("set-recording-state", (event, isRecording) => {
      try {
        if (this.hotkeyManager) {
          this.hotkeyManager.setRecordingState(isRecording);
          return { success: true };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("设置录音状态失败:", error);
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle("get-recording-state", () => {
      try {
        if (this.hotkeyManager) {
          const isRecording = this.hotkeyManager.getRecordingState();
          return { success: true, isRecording };
        }
        return { success: false, error: "热键管理器未初始化" };
      } catch (error) {
        this.logger.error("获取录音状态失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 文件操作
    ipcMain.handle("export-transcriptions", (event, format) => {
      // TODO: 实现导出转录功能
      return { success: true, path: "" };
    });

    ipcMain.handle("import-settings", () => {
      // TODO: 实现导入设置功能
      return { success: true };
    });

    ipcMain.handle("export-settings", () => {
      // TODO: 实现导出设置功能
      return { success: true, path: "" };
    });

    // 文件系统相关
    ipcMain.handle("show-item-in-folder", (event, fullPath) => {
      require("electron").shell.showItemInFolder(fullPath);
    });

    ipcMain.handle("open-external", (event, url) => {
      require("electron").shell.openExternal(url);
    });

    // 系统信息
    ipcMain.handle("get-system-info", () => {
      return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron
      };
    });

    ipcMain.handle("check-permissions", async () => {
      try {
        // 检查辅助功能权限
        const hasAccessibility = await this.clipboardManager.checkAccessibilityPermissions();
        
        return {
          microphone: true, // 麦克风权限由前端检查
          accessibility: hasAccessibility
        };
      } catch (error) {
        this.logger.error("检查权限失败:", error);
        return {
          microphone: false,
          accessibility: false,
          error: error.message
        };
      }
    });

    ipcMain.handle("request-permissions", async () => {
      try {
        // 对于辅助功能权限，我们只能引导用户手动授予
        // 这里可以打开系统设置页面
        if (process.platform === "darwin") {
          this.clipboardManager.openSystemSettings();
        }
        return { success: true };
      } catch (error) {
        this.logger.error("请求权限失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 测试辅助功能权限
    ipcMain.handle("test-accessibility-permission", async () => {
      try {
        // 使用测试文本检查权限
        await this.clipboardManager.pasteText("蛐蛐輔助使用測試");
        return { success: true, message: "輔助使用權限測試成功" };
      } catch (error) {
        this.logger.error("辅助功能权限测试失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 打开系统权限设置
    ipcMain.handle("open-system-permissions", () => {
      try {
        if (process.platform === "darwin") {
          this.clipboardManager.openSystemSettings();
          return { success: true };
        } else {
          return { success: false, error: "目前平台不支援自動開啟權限設定" };
        }
      } catch (error) {
        this.logger.error("打开系统权限设置失败:", error);
        return { success: false, error: error.message };
      }
    });

    // 应用信息
    ipcMain.handle("get-app-version", () => {
      return require("electron").app.getVersion();
    });

    ipcMain.handle("get-app-path", (event, name) => {
      return require("electron").app.getPath(name);
    });

    ipcMain.handle("check-for-updates", () => {
      // TODO: 实现更新检查功能
      return { hasUpdate: false };
    });

    // 调试和日志
    ipcMain.handle("log", (event, level, message, data) => {
      this.logger[level](`[渲染进程] ${message}`, data || "");
      return true;
    });

    ipcMain.handle("get-debug-info", () => {
      return {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: require("electron").app.getVersion()
      };
    });

    // 保持向后兼容性
    ipcMain.handle("log-message", (event, level, message, data) => {
      this.logger[level](`[渲染进程] ${message}`, data || "");
      return true;
    });

    // 中文特定功能
    ipcMain.handle("detect-language", (event, text) => {
      // TODO: 实现语言检测功能
      return { language: "zh-CN", confidence: 0.95 };
    });

    ipcMain.handle("segment-chinese", (event, text) => {
      // TODO: 实现中文分词功能
      return { segments: text.split("") };
    });

    ipcMain.handle("add-punctuation", (event, text) => {
      // TODO: 实现标点符号添加功能
      return { text: text };
    });

    // 音频处理
    ipcMain.handle("convert-audio-format", (event, audioData, targetFormat) => {
      // TODO: 实现音频格式转换功能
      return { success: true, data: audioData };
    });

    ipcMain.handle("enhance-audio", (event, audioData) => {
      // TODO: 实现音频增强功能
      return { success: true, data: audioData };
    });

    // 模型管理 - 更新为实际功能
    ipcMain.handle("download-model", async (event, modelName) => {
      // 使用统一的模型下载功能
      return await this.funasrManager.downloadModels((progress) => {
        event.sender.send("model-download-progress", progress);
      });
    });

    ipcMain.handle("get-available-models", () => {
      // 返回FunASR支持的模型列表
      return {
        models: [
          {
            name: "paraformer-large",
            displayName: "Paraformer Large (ASR)",
            type: "asr",
            size: "840MB",
            description: "大型中文語音辨識模型"
          },
          {
            name: "fsmn-vad",
            displayName: "FSMN VAD",
            type: "vad",
            size: "1.6MB",
            description: "語音活動檢測模型"
          },
          {
            name: "ct-transformer-punc",
            displayName: "CT Transformer (標點)",
            type: "punc",
            size: "278MB",
            description: "標點符號恢復模型"
          }
        ]
      };
    });

    ipcMain.handle("get-current-model", async () => {
      const status = await this.funasrManager.checkStatus();
      return {
        model: "paraformer-large",
        status: status.models_downloaded ? "ready" : "not_downloaded",
        details: status
      };
    });

    ipcMain.handle("switch-model", (event, modelName) => {
      // FunASR目前使用固定模型组合，暂不支持切换
      return {
        success: false,
        error: "FunASR 使用固定模型組合，暫不支援切換單個模型"
      };
    });

    // 性能监控
    ipcMain.handle("get-performance-stats", () => {
      // TODO: 实现性能统计功能
      return { stats: {} };
    });

    ipcMain.handle("clear-performance-stats", () => {
      // TODO: 实现清除性能统计功能
      return { success: true };
    });

    // 错误报告
    ipcMain.handle("report-error", (event, error) => {
      this.logger.error("渲染进程错误:", error);
      // TODO: 实现错误报告功能
      return true;
    });

    // 开发工具
    if (process.env.NODE_ENV === "development") {
      ipcMain.handle("open-dev-tools", (event) => {
        const window = require("electron").BrowserWindow.fromWebContents(event.sender);
        if (window) {
          window.webContents.openDevTools();
        }
      });

      ipcMain.handle("reload-window", (event) => {
        const window = require("electron").BrowserWindow.fromWebContents(event.sender);
        if (window) {
          window.reload();
        }
      });
    }

    // 日志和调试相关
    ipcMain.handle("get-app-logs", (event, lines = 100) => {
      try {
        if (this.logger && this.logger.getRecentLogs) {
          return {
            success: true,
            logs: this.logger.getRecentLogs(lines)
          };
        }
        return {
          success: false,
          error: "日志管理器不可用"
        };
      } catch (error) {
        this.logger.error("获取应用日志失败:", error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    ipcMain.handle("get-funasr-logs", (event, lines = 100) => {
      try {
        if (this.logger && this.logger.getFunASRLogs) {
          return {
            success: true,
            logs: this.logger.getFunASRLogs(lines)
          };
        }
        return {
          success: false,
          error: "日志管理器不可用"
        };
      } catch (error) {
        this.logger.error("获取FunASR日志失败:", error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    ipcMain.handle("get-log-file-path", () => {
      try {
        if (this.logger && this.logger.getLogFilePath) {
          return {
            success: true,
            appLogPath: this.logger.getLogFilePath(),
            funasrLogPath: this.logger.getFunASRLogFilePath()
          };
        }
        return {
          success: false,
          error: "日志管理器不可用"
        };
      } catch (error) {
        this.logger.error("获取日志文件路径失败:", error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    ipcMain.handle("open-log-file", (event, logType = 'app') => {
      try {
        if (this.logger) {
          const logPath = logType === 'funasr'
            ? this.logger.getFunASRLogFilePath()
            : this.logger.getLogFilePath();
          
          require("electron").shell.showItemInFolder(logPath);
          return { success: true };
        }
        return {
          success: false,
          error: "日志管理器不可用"
        };
      } catch (error) {
        this.logger.error("打开日志文件失败:", error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    ipcMain.handle("get-system-debug-info", () => {
      try {
        const debugInfo = {
          system: {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            electronVersion: process.versions.electron,
            appVersion: require("electron").app.getVersion()
          },
          environment: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            PYTHON_PATH: process.env.PYTHON_PATH,
            AI_API_KEY: '透過控制面板設定',
            AI_BASE_URL: '透過控制面板設定',
            AI_MODEL: '透過控制面板設定'
          },
          funasrStatus: {
            isInitialized: this.funasrManager.isInitialized,
            modelsInitialized: this.funasrManager.modelsInitialized,
            serverReady: this.funasrManager.serverReady,
            pythonCmd: this.funasrManager.pythonCmd
          }
        };

        if (this.logger && this.logger.getSystemInfo) {
          debugInfo.loggerInfo = this.logger.getSystemInfo();
        }

        return {
          success: true,
          debugInfo
        };
      } catch (error) {
        this.logger.error("获取系统调试信息失败:", error);
        return {
          success: false,
          error: error.message
        };
      }
    });

    ipcMain.handle("test-python-environment", async () => {
      try {
        this.logger && this.logger.info && this.logger.info('开始测试Python环境');
        
        const pythonCmd = await this.funasrManager.findPythonExecutable();
        const funasrStatus = await this.funasrManager.checkFunASRInstallation();
        
        const testResult = {
          success: true,
          pythonCmd,
          funasrStatus,
          timestamp: new Date().toISOString()
        };

        this.logger && this.logger.info && this.logger.info('Python环境测试完成', testResult);
        
        return testResult;
      } catch (error) {
        const errorResult = {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        };

        this.logger && this.logger.error && this.logger.error('Python环境测试失败', errorResult);
        
        return errorResult;
      }
    });

    ipcMain.handle("restart-funasr-server", async () => {
      try {
        this.logger && this.logger.info && this.logger.info('手动重启FunASR服务器');
        
        // 使用新的restartServer方法
        const result = await this.funasrManager.restartServer();
        
        return result;
      } catch (error) {
        this.logger && this.logger.error && this.logger.error('重启FunASR服务器失败', error);
        return {
          success: false,
          error: error.message
        };
      }
    });
  }

  // AI文本处理方法
  async processTextWithAI(text, mode = 'optimize') {
    try {
      // 从数据库设置中获取API密钥
      const apiKey = await this.databaseManager.getSetting('ai_api_key');
      if (!apiKey) {
        return {
          success: false,
          error: '請先在設定頁面設定 AI API 金鑰'
        };
      }

      const prompts = {
        format: `請將以下文字進行格式化，加入適當的段落分隔，使其更易閱讀：\n\n${text}`,
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
3.  **禁止改變句式**：不能為了「最佳化」而重組使用者的句子結構，例如將主動句改為被动句。
4.  **禁止增刪情感或語氣詞**：必須保留所有表達情感和語氣的詞，如「啊」、「呀」、「呢」、「吧」、「嘛」、「喔」、「哦」等。注意區分它們和第 2 條指令中提到的「無意義填充詞」。
5.  **禁止主觀臆斷**：不能添加任何原始文字中不存在的資訊，或基於猜測去「完善」句子。

原始文字：
\`\`\`
${text}
\`\`\`

# 輸出格式
- **輸出**: 直接回傳最佳化後的文字，不要包含任何解釋、前言或總結。`,
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
        enhance: `請對以下文字進行內容最佳化：

**最佳化要求：**
1. **嚴格保持原意和語意不變**
2. 修正明顯的用詞錯誤和語法問題
3. 最佳化表達方式，使語言更加準確且流暢
4. 可以調整標點符號以提升文字品質
5. 保留原文的語言風格

**注意事項：**
- 對於詩詞、成語、俗語等固定表達，請保持原樣
- 寧可保守處理，也不要過度修改

原始文字：
${text}

請直接回傳最佳化後的文字，不需要解釋過程。`
      };

      const baseUrl = await this.databaseManager.getSetting('ai_base_url') || 'https://api.openai.com/v1';
      const model = await this.databaseManager.getSetting('ai_model') || 'gpt-3.5-turbo';

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

      this.logger.info('AI文本处理请求:', {
        baseUrl,
        model,
        mode,
        inputText: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        requestData
      });

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorData = { error: response.statusText };
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || response.statusText };
        }
        throw new Error(errorData.error?.message || errorData.error || `API error: ${response.status}`);
      }

      const data = await response.json();

      this.logger.info('AI文本处理响应:', {
        status: response.status,
        data: data,
        usage: data.usage
      });

      if (data.choices && data.choices.length > 0) {
        const result = {
          success: true,
          text: data.choices[0].message.content.trim(),
          usage: data.usage,
          model: model
        };
        
        this.logger.info('AI文本处理结果:', {
          originalText: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
          optimizedText: result.text.substring(0, 100) + (result.text.length > 100 ? '...' : ''),
          usage: result.usage
        });
        
        return result;
      } else {
        this.logger.error('AI API返回数据格式错误:', response.data);
        return {
          success: false,
          error: 'AI API 回傳資料格式錯誤'
        };
      }
    } catch (error) {
      this.logger.error('AI文本处理失败:', error);
      
      let errorMessage = '文字處理失敗';
      if (error.response) {
        // API错误响应
        if (error.response.status === 401) {
          errorMessage = 'API 金鑰無效，請檢查設定';
        } else if (error.response.status === 429) {
          errorMessage = 'API 呼叫頻率超限，請稍後重試';
        } else if (error.response.status === 500) {
          errorMessage = 'AI 伺服器錯誤，請稍後重試';
        } else {
          errorMessage = `API 錯誤: ${error.response.status}`;
        }
      } else if (error.code === 'ECONNABORTED') {
        errorMessage = '請求逾時，請檢查網路連線';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = '無法連線至 AI 伺服器，請檢查網路';
      } else {
        errorMessage = error.message || '未知錯誤';
      }

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // 检查AI状态
  async checkAIStatus(testConfig = null) {
    try {
      this.logger.info('开始测试AI配置...', testConfig ? '使用临时配置' : '使用已保存配置');
      
      // 如果提供了测试配置，使用测试配置；否则使用已保存的配置
      let apiKey, baseUrl, model;
      
      if (testConfig) {
        apiKey = testConfig.ai_api_key;
        baseUrl = testConfig.ai_base_url || 'https://api.openai.com/v1';
        model = testConfig.ai_model || 'gpt-3.5-turbo';
        this.logger.info('使用临时测试配置:', { baseUrl, model, apiKeyLength: apiKey?.length || 0 });
      } else {
        apiKey = await this.databaseManager.getSetting('ai_api_key');
        baseUrl = await this.databaseManager.getSetting('ai_base_url') || 'https://api.openai.com/v1';
        model = await this.databaseManager.getSetting('ai_model') || 'gpt-3.5-turbo';
        this.logger.info('使用已保存配置:', { baseUrl, model, apiKeyLength: apiKey?.length || 0 });
      }
      
      if (!apiKey) {
        this.logger.warn('AI测试失败: 未配置API密钥');
        return {
          available: false,
          error: '未設定 API 金鑰',
          details: '請輸入 AI API 金鑰'
        };
      }
      
      this.logger.info('AI配置信息:', {
        baseUrl: baseUrl,
        model: model,
        apiKeyLength: apiKey.length
      });
      
      // 发送一个更有意义的测试请求
      const testMessage = '請回覆「測試成功」來確認 AI 服務正常運作';
      const requestData = {
        model: model,
        messages: [
          {
            role: 'user',
            content: testMessage
          }
        ],
        max_tokens: 50,
        temperature: 0.1
      };

      this.logger.info('发送AI测试请求:', requestData);

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });

      this.logger.info('AI API响应状态:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('AI API错误响应:', errorText);
        
        let errorData = { error: response.statusText };
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || response.statusText };
        }
        
        let errorMessage = errorData.error?.message || errorData.error || `HTTP ${response.status}`;
        if (response.status === 401) {
          errorMessage = 'API 金鑰無效或已過期';
        } else if (response.status === 403) {
          errorMessage = 'API 金鑰權限不足';
        } else if (response.status === 429) {
          errorMessage = 'API 呼叫頻率超限';
        } else if (response.status === 500) {
          errorMessage = 'AI 伺服器內部錯誤';
        }
        
        throw new Error(errorMessage);
      }

      const data = await response.json();
      this.logger.info('AI API成功响应:', data);

      if (!data.choices || data.choices.length === 0) {
        throw new Error('AI API 回傳格式異常：缺少 choices 欄位');
      }

      const aiResponse = data.choices[0].message?.content || '';
      this.logger.info('AI回复内容:', aiResponse);

      return {
        available: true,
        model: model,
        status: 'connected',
        response: aiResponse,
        usage: data.usage,
        details: `成功連線至 ${model}，回應時間正常`
      };
    } catch (error) {
      this.logger.error('AI配置测试失败:', error);
      
      let errorMessage = '連線失敗';
      if (error.message.includes('401')) {
        errorMessage = 'API 金鑰無效';
      } else if (error.message.includes('403')) {
        errorMessage = 'API 金鑰權限不足';
      } else if (error.message.includes('429')) {
        errorMessage = 'API 呼叫頻率超限';
      } else if (error.message.includes('ENOTFOUND')) {
        errorMessage = '無法連線至 AI 伺服器，請檢查網路與 Base URL';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = '連線被拒絕，請檢查 Base URL 是否正確';
      } else if (error.message.includes('timeout')) {
        errorMessage = '請求逾時，請檢查網路連線';
      } else {
        errorMessage = error.message || '未知錯誤';
      }

      return {
        available: false,
        error: errorMessage,
        details: `測試失敗原因: ${error.message}`
      };
    }
  }

  // 清理处理器
  removeAllHandlers() {
    ipcMain.removeAllListeners();
  }
}

module.exports = IPCHandlers;