# Rust desktop development

The native launch path uses Tauri 2, the existing React UI, and a Rust speech service backed by statically linked sherpa-onnx 1.13.8 / ONNX Runtime. It does not start Python. Electron remains available as a migration fallback through the original commands.

## Run on Windows

Install Rust stable (MSVC), Visual Studio C++ build tools, WebView2 and Node.js. Install the frontend dependencies with pnpm. The native build does not require rebuilding Electron's SQLite module; if the legacy Electron postinstall fails, use `pnpm install --ignore-scripts` for native development.

```powershell
pnpm install --ignore-scripts
npm run dev:rust
```

The launcher also finds rustup under `~/.cargo/bin` when the terminal PATH has not been refreshed. Vite still runs from `src/` on port 5173; Tauri waits for that service before loading the application.

Open Settings → Local speech engine to select SenseVoiceSmall INT8 or Paraformer. Download and switch loads the selected model after verifying every file's pinned length and SHA-256. Missing models never start an automatic download. SenseVoice requires about 240 MB including tokens and VAD; Paraformer with punctuation requires about 1.1 GB. Model weights live in the user data directory, outside the repository and installer.

SenseVoice supports Chinese, Cantonese, English, Japanese, Korean and automatic language mode. Its punctuation setting also controls inverse text normalization. Paraformer supports Chinese and English and uses a separate punctuation model. Neither engine currently supports contextual hotwords. The converted Paraformer checkpoint differs from the legacy FunASR checkpoint, so identical transcripts are not promised.

## Build and verify

```powershell
npm run test:desktop
npm run build:renderer
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path crates/ququ-speech/Cargo.toml
npm run build:rust
```

The Rust build command runs the renderer build before packaging. The default Windows bundle is NSIS. macOS configuration switches targets to app/DMG and declares microphone usage; macOS runtime permissions, paste integration and signed packaging require a separate platform validation pass after Windows.

For speech diagnostics without the UI:

```powershell
cargo run --manifest-path crates/ququ-speech/Cargo.toml --example smoke -- "$env:USERPROFILE/AppData/Roaming/蛐蛐/models/sherpa-onnx" status
cargo run --manifest-path crates/ququ-speech/Cargo.toml --example smoke -- "$env:USERPROFILE/AppData/Roaming/蛐蛐/models/sherpa-onnx" download
cargo run --manifest-path crates/ququ-speech/Cargo.toml --example smoke -- "$env:USERPROFILE/AppData/Roaming/蛐蛐/models/sherpa-onnx" transcribe C:/path/to/recording.wav
```

## Data continuity

Rust reuses the legacy `transcriptions.db`: `%USERPROFILE%/AppData/Roaming/蛐蛐` on Windows and `~/Library/Application Support/蛐蛐` on macOS. Before opening existing data for writes, it creates `transcriptions.pre-rust.db` using SQLite's backup API if that backup does not yet exist. Raw and processed transcription fields and JSON settings keep their existing schema.

## Current boundaries

Models and third-party native components have separate licenses. Downloaded model provenance and pinned hashes are in `crates/ququ-speech/src/models.rs`; inspect upstream model agreements before redistribution. Downloading weights at runtime does not make their license identical to the app's MIT license.

Native history exports support TXT and JSON. Legacy preload capabilities that have no implemented native equivalent return explicit errors. Linux is outside the initial Windows/macOS delivery milestones. Compilation and unit tests alone do not verify microphone capture, cross-application paste, or recognition accuracy.


## Classic / Compact interfaces and hotkeys

Settings → 界面模式 and the tray's 经典界面 / 精简界面 entries select the same persisted `interface_mode` preference. Classic keeps the original-style 400×500 microphone/status/transcript window, with copy, history, settings and a collapse button. Compact uses the 160×32 indicator with a gently breathing red dot and “Recording...” label with a 180 ms fade; it is hidden when idle, appears beside the mouse position sampled at recording start and stays fixed for that recording, ignores clicks and never activates. Both views use one recording owner, model, hotkey and transcription pipeline. Changing the visible mode does not reload the recorder or clear the latest result. Mode changes are rejected during microphone startup, recording, ASR and optional AI processing, except re-selecting the current Classic mode, which only unminimizes, shows and focuses the window in any state.

New installations start in Classic. Existing explicit mode choices are retained; older native settings containing `dictation_hotkey` migrate to Compact. Classic closes to the tray and is restored by re-selecting 经典界面 in the tray (there is no separate restore item). Its position is retained across mode switches in the running app. Settings/history remain separate windows. A Classic-button recording targets the last foreground external application; paste is refused if another external application has since taken focus.

In Settings → 录音快捷键, choose 重新捕获, press the desired shortcut, select toggle or hold, then 保存快捷键. Windows supports individual left/right Ctrl, Shift, Alt and Win, function keys and combinations. Ordinary typing keys without a modifier are rejected. Escape or switching windows cancels capture. A failed registration keeps the previous binding. Config is stored as `dictation_hotkey` in the existing SQLite settings table; legacy `global_hotkey` is read for migration. The default remains Ctrl+Shift+Space (Command on macOS), toggle mode.

Single-modifier capture is Windows-only. A modifier used as part of another shortcut does not toggle dictation; hold mode cancels that recording. Injected input and key repeats do not trigger native hooks. Optional AI failures fall back to local recognition; empty results create no history. Focus changes before paste leave the result in history and the clipboard. Cancellation invalidates pending recording/transcription work.

Verification: `npm run test:desktop`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`. With Vite running, use `node scripts/test-interface-ui.cjs`, `node scripts/test-compact-ui.cjs` and `npm run test:theme`. The opt-in native smoke script also checks capture, saved settings after reload, invalid shortcut rejection and restoration of the original configuration. Physical keyboard feel and microphone quality still require hands-on use.


## Performance evidence

See [Local ASR baseline](performance-baseline.md) and its recorded JSON for the reproducible 30-run SenseVoice benchmark. On the measured i7-1370P computer, a 5.592-second fixture produced warm p50 606.86 ms and p95 684.96 ms. These are local recognition pipeline times, not stop-to-paste or a Classic/Compact A/B result. Verification and process-cold model construction are reported separately.

Runtime `dictation-performance` log records contain numeric phase durations and outcome codes only. The start timestamp is captured when the controller receives stop intent, including MediaRecorder finalization and audio preparation before ASR. Preparation errors/cancellation also produce one report. Cloud AI, history writes and paste are timed separately so a subsequent corpus/desktop benchmark can identify the actual bottleneck without logging transcript contents.
