const { clipboard } = require("electron");
const { spawn } = require("child_process");

class ClipboardManager {
  constructor(logger) {
    // 初始化剪贴板管理器
    this.logger = logger;
    
    // 尝试加载 osascript 模块（仅在 macOS 上）
    this.osascript = null;
    if (process.platform === "darwin") {
      try {
        this.osascript = require("osascript");
        this.safeLog("✅ osascript 模块加载成功");
      } catch (error) {
        this.safeLog("⚠️ osascript 模块加载失败，将使用备用方法", error.message);
      }
    }
  }

  // 安全日志方法 - 使用logManager记录
  safeLog(message, data = null) {
    if (this.logger) {
      try {
        this.logger.info(message, data);
      } catch (error) {
        // 静默忽略 EPIPE 错误
        if (error.code !== "EPIPE") {
          process.stderr.write(`日志错误: ${error.message}\n`);
        }
      }
    }
  }

  // 简化的 macOS accessibility 检查
  async enableMacOSAccessibility() {
    if (process.platform !== "darwin") return true;
    
    try {
      this.safeLog("🔧 检查 macOS accessibility 权限");
      
      // 简化为基本的权限检查，不设置复杂的AXManualAccessibility
      const script = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
          return frontApp
        end tell
      `;
      
      const testProcess = spawn("osascript", ["-e", script]);
      
      return new Promise((resolve) => {
        testProcess.on("close", (code) => {
          if (code === 0) {
            this.safeLog("✅ macOS accessibility 权限正常");
            resolve(true);
          } else {
            this.safeLog("⚠️ macOS accessibility 权限不足");
            resolve(false);
          }
        });
        
        testProcess.on("error", () => {
          this.safeLog("❌ accessibility 权限检查失败");
          resolve(false);
        });
      });
    } catch (error) {
      this.safeLog("❌ 检查 macOS accessibility 时出错:", error.message);
      return false;
    }
  }

  // 简化的文本插入方法 - 直接使用标准粘贴方式
  async insertTextDirectly(text) {
    // 简化实现，直接使用标准的粘贴方法
    this.safeLog("🎯 使用标准粘贴方式插入文本");
    return await this.pasteText(text);
  }

  async pasteText(text) {
    try {
      // 首先保存原始剪贴板内容
      const originalClipboard = clipboard.readText();
      this.safeLog(
        "💾 已保存原始剪贴板内容",
        originalClipboard.substring(0, 50) + "..."
      );

      // 将文本复制到剪贴板 - 这总是有效的
      clipboard.writeText(text);
      this.safeLog(
        "📋 文本已复制到剪贴板",
        text.substring(0, 50) + "..."
      );

      if (process.platform === "darwin") {
        // 简化权限检查，直接尝试粘贴
        this.safeLog("🔍 检查粘贴操作的辅助功能权限");
        const hasPermissions = await this.checkAccessibilityPermissions();

        if (!hasPermissions) {
          this.safeLog("⚠️ 没有辅助功能权限 - 文本仅复制到剪贴板");
          const errorMsg =
            "需要輔助使用權限才能自動貼上。文字已複製至剪貼簿 — 請手動使用 Cmd+V 貼上。";
          throw new Error(errorMsg);
        }

        this.safeLog("✅ 权限已授予，尝试粘贴");
        return await this.pasteMacOS(originalClipboard);
      } else if (process.platform === "win32") {
        return await this.pasteWindows(originalClipboard);
      } else {
        return await this.pasteLinux(originalClipboard);
      }
    } catch (error) {
      throw error;
    }
  }

  async pasteMacOS(originalClipboard) {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const pasteProcess = spawn("osascript", [
          "-e",
          'tell application "System Events" to keystroke "v" using command down',
        ]);

        let errorOutput = "";
        let hasTimedOut = false;

        pasteProcess.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        pasteProcess.on("close", (code) => {
          if (hasTimedOut) return;

          // 首先清除超时
          clearTimeout(timeoutId);

          // 清理进程引用
          pasteProcess.removeAllListeners();

          if (code === 0) {
            this.safeLog("✅ 通过 Cmd+V 模拟成功粘贴文本");
            setTimeout(() => {
              clipboard.writeText(originalClipboard);
              this.safeLog("🔄 原始剪贴板内容已恢复");
            }, 100);
            resolve();
          } else {
            const errorMsg = `貼上失敗 (代碼 ${code})。文字已複製至剪貼簿 — 請手動使用 Cmd+V 貼上。`;
            reject(new Error(errorMsg));
          }
        });

        pasteProcess.on("error", (error) => {
          if (hasTimedOut) return;
          clearTimeout(timeoutId);
          pasteProcess.removeAllListeners();
          const errorMsg = `貼上指令失敗: ${error.message}。文字已複製至剪貼簿 — 請手動使用 Cmd+V 貼上。`;
          reject(new Error(errorMsg));
        });

        const timeoutId = setTimeout(() => {
          hasTimedOut = true;
          pasteProcess.kill("SIGKILL");
          pasteProcess.removeAllListeners();
          const errorMsg =
            "貼上操作逾時。文字已複製至剪貼簿 — 請手動使用 Cmd+V 貼上。";
          reject(new Error(errorMsg));
        }, 3000);
      }, 100);
    });
  }

  async pasteWindows(originalClipboard) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("powershell", [
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ]);

      pasteProcess.on("close", (code) => {
        if (code === 0) {
          // 文本粘贴成功
          setTimeout(() => {
            clipboard.writeText(originalClipboard);
          }, 100);
          resolve();
        } else {
          reject(
            new Error(
              `Windows 貼上失敗，代碼 ${code}。文字已複製至剪貼簿。`
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        reject(
          new Error(
            `Windows 貼上失敗: ${error.message}。文字已複製至剪貼簿。`
          )
        );
      });
    });
  }

  async pasteLinux(originalClipboard) {
    return new Promise((resolve, reject) => {
      const pasteProcess = spawn("xdotool", ["key", "ctrl+v"]);

      pasteProcess.on("close", (code) => {
        if (code === 0) {
          // 文本粘贴成功
          setTimeout(() => {
            clipboard.writeText(originalClipboard);
          }, 100);
          resolve();
        } else {
          reject(
            new Error(
              `Linux 貼上失敗，代碼 ${code}。文字已複製至剪貼簿。`
            )
          );
        }
      });

      pasteProcess.on("error", (error) => {
        reject(
          new Error(
            `Linux 貼上失敗: ${error.message}。文字已複製至剪貼簿。`
          )
        );
      });
    });
  }

  async checkAccessibilityPermissions() {
    if (process.platform !== "darwin") return true;

    return new Promise((resolve) => {
      // 检查辅助功能权限
      const testProcess = spawn("osascript", [
        "-e",
        'tell application "System Events" to get name of first process',
      ]);

      let testOutput = "";
      let testError = "";

      testProcess.stdout.on("data", (data) => {
        testOutput += data.toString();
      });

      testProcess.stderr.on("data", (data) => {
        testError += data.toString();
      });

      testProcess.on("close", (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          this.showAccessibilityDialog(testError);
          resolve(false);
        }
      });

      testProcess.on("error", (error) => {
        resolve(false);
      });
    });
  }

  showAccessibilityDialog(testError) {
    const isStuckPermission =
      testError.includes("not allowed assistive access") ||
      testError.includes("(-1719)") ||
      testError.includes("(-25006)");

    let dialogMessage;
    if (isStuckPermission) {
      dialogMessage = `🔒 蛐蛐需要輔助使用權限，但看起來您可能有來自先前版本的舊權限。

❗ 常見問題：如果您重新建置／重新安裝了蛐蛐，舊權限可能「卡住」並阻止新權限。

🔧 解決方法：
1. 開啟系統設定 → 隱私權與安全性 → 輔助使用
2. 尋找任何舊的「蛐蛐」項目並刪除（點擊 - 按鈕）
3. 同時刪除任何顯示「Electron」或名稱不明確的項目
4. 點擊 + 按鈕並手動加入新的蛐蛐應用程式
5. 確保核取方塊已啟用
6. 重新啟動蛐蛐

⚠️ 這在開發期間重新建置應用程式時特別常見。

📝 沒有此權限，文字將只會複製至剪貼簿（無自動貼上）。

您想現在開啟系統設定嗎？`;
    } else {
      dialogMessage = `🔒 蛐蛐需要輔助使用權限才能將文字貼上至其他應用程式中。

📋 目前狀態：剪貼簿複製有效，但貼上（Cmd+V 模擬）失敗。

🔧 解決方法：
1. 開啟系統設定（或較舊 macOS 上的系統偏好設定）
2. 前往隱私權與安全性 → 輔助使用
3. 點擊鎖頭圖示並輸入您的密碼
4. 將蛐蛐加入列表中並勾選核取方塊
5. 重新啟動蛐蛐

⚠️ 沒有此權限，聽寫文字將只會複製至剪貼簿但不會自動貼上。

💡 在正式發行版本中，此權限為完整功能所必需。

您想現在開啟系統設定嗎？`;
    }

    const permissionDialog = spawn("osascript", [
      "-e",
      `display dialog "${dialogMessage}" buttons {"取消", "開啟系統設定"} default button "開啟系統設定"`,
    ]);

    permissionDialog.on("close", (dialogCode) => {
      if (dialogCode === 0) {
        this.openSystemSettings();
      }
    });

    permissionDialog.on("error", (error) => {
      // 权限对话框错误 - 用户需要手动授予权限
    });
  }

  openSystemSettings() {
    const settingsCommands = [
      [
        "open",
        [
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        ],
      ],
      ["open", ["-b", "com.apple.systempreferences"]],
      ["open", ["/System/Library/PreferencePanes/Security.prefPane"]],
    ];

    let commandIndex = 0;
    const tryNextCommand = () => {
      if (commandIndex < settingsCommands.length) {
        const [cmd, args] = settingsCommands[commandIndex];
        const settingsProcess = spawn(cmd, args);

        settingsProcess.on("error", (error) => {
          commandIndex++;
          tryNextCommand();
        });

        settingsProcess.on("close", (settingsCode) => {
          if (settingsCode !== 0) {
            commandIndex++;
            tryNextCommand();
          }
        });
      } else {
        // 所有设置命令都失败，尝试后备方案
        spawn("open", ["-a", "System Preferences"]).on("error", () => {
          spawn("open", ["-a", "System Settings"]).on("error", () => {
            // 无法打开设置应用
          });
        });
      }
    };

    tryNextCommand();
  }

  /**
   * 复制文本到剪贴板
   * @param {string} text - 要复制的文本
   * @returns {Promise<{success: boolean}>}
   */
  async copyText(text) {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      throw error;
    }
  }

  /**
   * 从剪贴板读取文本
   * @returns {Promise<string>}
   */
  async readClipboard() {
    try {
      const text = clipboard.readText();
      return text;
    } catch (error) {
      throw error;
    }
  }

  /**
   * 将文本写入剪贴板
   * @param {string} text - 要写入的文本
   * @returns {Promise<{success: boolean}>}
   */
  async writeClipboard(text) {
    try {
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      throw error;
    }
  }
}

module.exports = ClipboardManager;