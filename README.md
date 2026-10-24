<div align="center">

<!-- 在這裡放置您的Logo圖片 -->
<!-- 例如: <img src="assets/logo.png" width="150" /> -->
<br/>
<br/>

# 蛐蛐 (QuQu)

**開源免費的 Wispr Flow 替代方案 | 為中文而生的下一代智慧語音工作流程**

</div>

<div align="center">

<!-- 徽章 (Badges) -->
<img src="https://img.shields.io/badge/license-Apache_2.0-blue.svg" alt="License">
<img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platform">
<img src="https://img.shields.io/badge/release-v1.0.0-brightgreen" alt="Release">
<img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome">

</div>

<br/>

> **厭倦了 Wispr Flow 的訂閱費用？尋找開源免費的語音輸入方案？來試試「蛐蛐」！**

**蛐蛐 (QuQu)** 是 **Wispr Flow 的開源免費替代方案**，專為中文使用者打造、注重隱私的桌面端語音輸入與文字處理工具。與 Wispr Flow 不同，蛐蛐完全開源免費，資料於本機處理，專為中文最佳化，支援多款 AI 模型。

### 🆚 vs Wispr Flow：開源免費的替代方案

| 核心比較 | 🎯 蛐蛐 (QuQu) | 💰 Wispr Flow |
|---------|---------------|---------------|
| **價格** | ✅ **完全免費** | ❌ $12/月訂閱 |
| **隱私** | ✅ **本機處理** | ❌ 雲端處理 |
| **中文** | ✅ **專為中文最佳化** | ⚠️ 通用支援 |
| **AI 模型** | ✅ **多元 AI 支援** | ❌ 僅國外模型 |

想像一下，您可以像和朋友聊天一樣寫作。說的內容被即時、精準地轉換成文字，口誤和「嗯、啊」等贅字被自動修正，甚至能根據您的要求，自動整理成電子郵件格式或程式碼片段。**這就是「蛐蛐」為您帶來的體驗 —— 而且完全免費！**

---

## ✨ 核心優勢

| 特性 | 蛐蛐 (QuQu) 的解決方案 |
| :--- | :--- |
| 🎯 **頂尖中文辨識，隱私至上** | 內建阿里巴巴 **FunASR Paraformer** 模型，在您的電腦本機執行。這代表它能聽懂中文網路用語，也能保護您最私密的語音資料不被上傳。 |
| 💡 **會思考的「兩段式引擎」** | 獨創 **「ASR 精準辨識 + LLM 智慧最佳化」** 工作流程。它不僅能轉錄，更能「理解」與「重塑」您的語言。**自動過濾口頭禪**、**修正錯誤表述**（例如將「週三開會，不對，是週四」直接輸出為「週四開會」），這些都只是基礎操作。 |
| 🌐 **開放且靈活的 AI 生態** | 支援任何相容 OpenAI API 的服務，並**優先適配主流頂尖模型**（如通義千問、Kimi 等）。這意味著更快的反應速度、更低的費用與更好的合規性。 |
| 🚀 **開發者與效率專家摯愛** | 能準確辨識並格式化 `camelCase` 與 `snake_case` 等程式設計術語。透過自訂 AI 指令，更能實現**情境感知**，根據您目前的應用程式（寫程式碼、回覆電子郵件）智慧調整輸出格式。 |


## 🎬 功能展示

<p align="center"><i>(這裡是應用程式的 GIF 展示圖)</i></p>

- **一鍵喚醒**: 全域快速鍵 F2，隨時隨地開始記錄。
- **即時辨識**: 本機 FunASR 引擎提供高精度中文辨識。
- **智慧最佳化**: 連接您的 AI 模型，自動潤飾、除錯、摘要。
- **無縫貼上**: 轉換完成的文字自動貼上至您目前的游標位置。

### 🚀 從 Wispr Flow 遷移？

如果您正在使用 Wispr Flow 但希望**節省訂閱費用**、**保護隱私資料**、**獲得更好的中文支援**，那麼蛐蛐就是您的完美選擇！

## 🚀 快速開始

### 1. 環境需求
- **Node.js 18+** 與 pnpm
- **Python 3.8+** (用於執行本機 FunASR 服務)
- **macOS 10.15+**, **Windows 10+**, 或 **Linux**

### 2. 專案初始化

#### 方案一：使用 uv (推薦) 🌟

[uv](https://github.com/astral-sh/uv) 是現代化的 Python 套件管理工具，能自動管理 Python 版本與相依套件，避免環境衝突：

```bash
# 1. 複製專案
git clone https://github.com/yan5xu/ququ.git
cd ququ

# 2. 安裝 Node.js 相依套件
pnpm install

# 3. 安裝 uv (如果尚未安裝)
# macOS/Linux:
curl -LsSf https://astral.sh/uv/install.sh | sh
# Windows:
# powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

# 4. 初始化 Python 環境 (uv 會自動下載 Python 3.11 與所有相依套件)
uv sync

# 5. 下載 FunASR 模型
uv run python download_models.py

# 6. 啟動應用程式！
pnpm run dev
```

#### 方案二：使用系統 Python

如果您更偏好使用系統 Python 環境：

```bash
# 1. 複製專案
git clone https://github.com/yan5xu/ququ.git
cd ququ

# 2. 安裝 Node.js 相依套件
pnpm install

# 3. 建立虛擬環境 (推薦)
python3 -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# 4. 安裝 Python 相依套件
pip install funasr modelscope torch torchaudio librosa numpy

# 5. 下載 FunASR 模型
python download_models.py

# 6. 啟動應用程式！
pnpm run dev
```

#### 方案三：使用嵌入式 Python 環境

專案亦支援完全隔離的嵌入式 Python 環境（主要用於正式打包）：

```bash
# 1-2. 同上複製專案與安裝 Node.js 相依套件

# 3. 準備嵌入式 Python 環境
pnpm run prepare:python

# 4. 測試環境是否正常
pnpm run test:python

# 5. 啟動應用程式
pnpm run dev
```

### 3. 設定 AI 模型
啟動應用程式後，在 **設定頁面** 中填入您的 AI 服務商提供的 **API Key**、**Base URL** 與 **模型名稱**。支援通義千問、Kimi、智譜 AI 等相容 OpenAI 介面的模型，設定將自動儲存在本機。

### 4. 疑難排解

#### 常見初始化問題

**問題**: `ModuleNotFoundError: No module named 'funasr'`
```bash
# 解決方案 1: 使用 uv (推薦)
uv sync
uv run python download_models.py

# 解決方案 2: 重新安裝相依套件
pip install funasr modelscope torch torchaudio librosa numpy

# 解決方案 3: 使用嵌入式環境
pnpm run prepare:python
```

**問題**: FunASR 模型下載失敗或載入緩慢
```bash
# 檢查網路連線，確保能連線至 modelscope.cn
# 如果在 macOS 上遇到 SSL 警告：
pip install "urllib3<2.0"

# 手動下載模型：
python download_models.py
# 或使用 uv:
uv run python download_models.py
```

**問題**: Python 版本不相容
```bash
# 使用 uv 自動管理 Python 版本 (推薦)
uv sync  # 會自動下載 Python 3.11

# 或手動安裝 Python 3.8+
# 檢查目前版本: python3 --version
```

#### 環境選擇建議

| 使用情境 | 推薦方案 | 優點 |
|---------|---------|------|
| **新使用者／快速體驗** | uv | 自動管理，無環境衝突 |
| **開發者／自訂需求** | 系統 Python + 虛擬環境 | 彈性控制，便於除錯 |
| **正式部署** | 嵌入式環境 | 完全隔離，無外部相依 |

#### 其他常見問題

- **權限問題**: 在某些系統上可能需要使用 `--user` 參數安裝 Python 套件
- **網路問題**: 首次執行時需要下載 FunASR 模型，請確保網路連線正常
- **模型路徑**: 模型預設下載至 `~/.cache/modelscope/` 目錄

## 🛠️ 技術堆疊

- **前端**: React 19, TypeScript, Tailwind CSS, shadcn/ui, Vite
- **桌面端**: Electron
- **語音技術 (本機)**: FunASR (Paraformer-large, FSMN-VAD, CT-Transformer)
- **AI 模型 (可自訂)**: 相容 OpenAI, Anthropic, 阿里雲通義千問, Kimi 等
- **資料庫**: better-sqlite3

## 🤝 參與貢獻

我們是一個開放且友善的社群，歡迎任何形式的貢獻！

### 📋 專案管理

我們使用 GitHub Projects 來管理專案的開發進度與任務規劃：

- 📊 **專案看板**: [蛐蛐 開發看板](https://github.com/users/yan5xu/projects/2) - 查看目前開發狀態、功能規劃與進度追蹤
- 🎯 **任務管理**: 所有功能開發、Bug 修復與改進建議都在專案看板中進行追蹤
- 🔄 **開發流程**: 從想法提出到功能發布的完整流程視覺化

### 如何參與

- 🤔 **提出建議**: 對產品有任何想法？歡迎至 [Issues](https://github.com/yan5xu/ququ/issues) 頁面提出。
- 🐛 **回報 Bug**: 發現程式發生錯誤？請毫不猶豫地告訴我們。
- 💻 **貢獻程式碼**: 如果您想新增功能或修復 Bug，請參考以下步驟：
    1.  Fork 本專案
    2.  建立您的功能分支 (`git checkout -b feature/your-amazing-feature`)
    3.  提交您的變更 (`git commit -m 'feat: Add some amazing feature'`)
    4.  將您的分支推送到遠端 (`git push origin feature/your-amazing-feature`)
    5.  建立一個 Pull Request

## 💬 交流與社群 (Communication & Community)

「蛐蛐」是一個由社群驅動的開源專案，我們相信開放的交流能激發最好的創意。您的每一個想法、每一次回饋都對專案至關重要。

我們誠摯地邀請您加入官方微信交流群，在這裡您可以：

*   🚀 **取得一手資訊**：第一時間了解專案更新、新功能預告與開發藍圖。
*   💬 **直接與開發者對話**：遇到安裝難題？有絕妙的功能點子？在群組裡可以直接 @ 作者與核心貢獻者。
*   💡 **分享與學習**：交流您的 AI 指令 (Prompt) 與自動化工作流程，看看其他人是怎麼把「蛐蛐」發揮到極致。
*   🤝 **參與專案共建**：從一個想法的提出，到一次程式碼的提交 (Pull Request)，社群是您最好的起點。

<div align="center">

| 微信掃碼，加入官方交流群 |
| :----------------------------------------------------------: |
| <img src="assets/wechat-community-qrcode.png" width="200" alt="QuQu Official WeChat Group" /> <br> *QuQu Official WeChat Group* |
| <p style="font-size:12px; color: #888;">如果二維碼過期或無法加入，請在 <a href="https://github.com/yan5xu/ququ/issues">Issues</a> 中提一個 Issue 提醒我們，謝謝！</p> |

</div>

## 🙏 致謝

本專案的誕生離不開以下優秀專案的啟發與支援：

- [FunASR](https://github.com/modelscope/FunASR): 阿里巴巴開源的工業級語音辨識工具組。
- [OpenWhispr](https://github.com/HeroTools/open-whispr): 為本專案提供了優秀的架構參考。
- [shadcn/ui](https://ui.shadcn.com/): 提供了高品質、可組合的 React 元件。

## 📄 授權條款

本專案採用 [Apache License 2.0](LICENSE) 授權條款。
# Rust / Tauri 遷移與 Release 打包

原生版本保留 React，使用 Rust 桌面服務與 SenseVoice / Paraformer 本機推論。啟動開發模式：`npm run dev:rust`。開發、模型下載與驗證說明見 [Rust desktop development](docs/rust-desktop.md)。原有 Electron 指令暫時保留。

## Windows / macOS 獨立執行檔與安裝套件建置

完整步驟見 [Deployment README — Windows & macOS](docs/DEPLOYMENT.md)，包括建置環境、安裝套件路徑、簽署、公證、麥克風權限、模型下載與升級。

### 1. Windows 本機編譯與打包

在 Windows (x64) 開發機上執行：

```powershell
# 編譯獨立 Release 執行檔 (.exe) 並產生 NSIS 安裝套件
npm run build:rust
```

產生產物：
- **獨立可執行檔**：`src-tauri/target/release/ququ-desktop.exe`（單一檔案執行，不依賴 Python、Node.js 或 Electron）
- **NSIS 安裝套件**：`src-tauri/target/release/bundle/nsis/蛐蛐_1.0.0_x64-setup.exe`

### 2. macOS 本機編譯與打包

在 Mac 開發機上執行（需安裝 Xcode Command Line Tools 與 Rust target）：

```bash
# 安裝前端相依套件
pnpm install --frozen-lockfile --ignore-scripts

# 1. Apple Silicon 版（M1/M2/M3/M4 系列，推薦）
npm run build:rust -- --config src-tauri/tauri.macos.conf.json --target aarch64-apple-darwin

# 2. Intel Mac 版
npm run build:rust -- --config src-tauri/tauri.macos.conf.json --target x86_64-apple-darwin
```

產生產物：
- `src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg` 與 `*.app`
- `src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/*.dmg` 與 `*.app`

### 3. GitHub Actions 自動雲端打包

專案已設定自動化 CI/CD 工作流程：
- **macOS 專用建置工作流程** [`.github/workflows/macos.yml`](.github/workflows/macos.yml)：
  - 程式碼推送或 PR 時自動在 macOS 14 虛擬機上平行建置 Apple Silicon (`aarch64`) 與 Intel (`x64`) 版本的 `.dmg` 安裝套件與 `.app.zip` 程式套件，並自動上傳 Artifacts。
  - 支援在 GitHub Actions 頁面手動選擇架構觸發（`workflow_dispatch`，可選擇 `all`、`arm64` 或 `x64`）。
- **全平台發布工作流程** [`.github/workflows/release.yml`](.github/workflows/release.yml)：
  - 推送版本標籤（如 `git tag v1.0.0 && git push origin v1.0.0`）或手動觸發。
  - 自動化任務將分別在 Windows 與 macOS 虛擬機中編譯全套安裝套件，並直接附加至 GitHub Release。

> **註**：以上建置指令專用於 Rust/Tauri 原生版本，原有 `build:win` / `build:mac` 仍屬於舊版 Electron/Python 架構。
