# Rust desktop and speech implementation plan

> **For agentic workers:** Use superpowers:executing-plans for the desktop work; the user explicitly delegated the independent speech workstream to a subagent.

**Goal:** Run the existing React dictation application in Tauri with native Rust speech, including SenseVoice, without requiring Python for the Rust launch path.

**Architecture:** Tauri commands implement the existing frontend contract through a desktop adapter. `ququ-speech` owns native inference and model lifecycle independently of Tauri. Preserve the Electron fallback until end-to-end verification.

**Tech Stack:** Rust, Tauri 2, React/Vite, rusqlite, reqwest, sherpa-onnx.

**Spec:** `docs/superpowers/specs/2026-10-23-rust-desktop-design.md` and `2026-10-23-rust-speech-engine-design.md`.

## Global constraints

- Windows first, then macOS. Retain React and existing SQLite data.
- SenseVoice selectable; fresh installations default to SenseVoice, existing explicit selections remain.
- No Python subprocess in the native Rust launch path. Native C/C++ inference dependencies are allowed.
- Explicit errors for missing models, unsupported hotwords and unimplemented capabilities; no false success placeholders.
- Keep credentials out of structured logs; downloads must not turn partial files into ready models.

## Review focus

- Async frontend listener setup after component unmount must release the listener.
- Existing JSON settings/history must survive database reuse and restart.
- Empty, malformed and oversized audio must fail before inference.
- Failed model switching must retain the prior usable model.
- All frontend entry points must initialize the adapter before mounting React.

### Task 1: Desktop API adapter and Tauri host

**Files:** `src/desktop/bridge.js`, `src/desktop/bridge.test.mjs`, frontend entry points, `src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,src/main.rs,src/lib.rs}`, `package.json`.

**Interfaces:** frontend keeps `window.electronAPI`; commands accept named arguments and events retain Electron callback payload convention. `createDesktopAPI({invoke,listen})` is independently testable.

- [x] Write Node tests for invoke mapping, callback arguments and unsubscribe-before-listen-resolves; run and observe missing-module failure.
- [x] Implement bridge and mount initialization, preserving existing Electron preload when present.
- [x] Configure Tauri multi-window host, development/build commands and scoped permissions. Vite remains rooted at `src`.
- [x] Run bridge tests and renderer build; verify host compiles.

### Task 2: Persistent desktop services

**Files:** `src-tauri/src/{database,ai,logging,commands,windows}.rs`, focused Rust tests.

**Interfaces:** database saves transcription JSON and returns `{lastInsertRowid,changes}`; get/set settings use JSON; command results preserve shapes consumed in React.

- [ ] Write SQLite tests for legacy schema, Unicode text, pagination and JSON settings; run failing tests.
- [x] Implement legacy data directory reuse, backup before migration, SQLite operations and defaults.
- [x] Port AI prompt modes and configured API requests, structured logs and window controls.
- [x] Verify Rust unit tests and frontend contract tests.

### Task 3: Native speech service (delegated)

**Files:** `crates/ququ-speech/Cargo.toml`, `crates/ququ-speech/src/*` and crate tests.

**Interfaces:** `SpeechService::new(model_root)`; `status(engine)`, `download_models(engine, progress)`, `transcribe_wav(bytes, options)`, `switch_engine(engine)`; agent must send exact final signatures before desktop integration. JSON responses preserve `success`, `text`, `raw_text`, `confidence`, `duration`, `language`, `model_type`. Progress retains existing fields and adds engine ID.

- [ ] Agent writes tests first for WAV validation, model readiness, bounded segmentation and switch rollback.
- [ ] Implement SenseVoice and Paraformer using pinned released official Rust bindings and a verified model manifest.
- [ ] Implement download progress, integrity validation, safe extraction and native inference on a serialized worker.
- [ ] Run crate tests and model-backed smoke test if model artifacts are available; record concrete verification gaps.

### Task 4: Native integration and settings

**Files:** `src-tauri/src/{speech,shortcuts,clipboard,tray}.rs`, React recording/settings/model status components.

**Interfaces:** native commands implement observed frontend methods; model engine and language persisted with Rust database service. Shortcut events target main dictation window only.

- [ ] Add contract tests for selected-model status and required-model dependency sets.
- [x] Connect speech service, model progress events, settings engine/language/normalization controls.
- [x] Port clipboard/paste, tray and shortcuts; fix recording codec selection for WebViews.
- [x] Run Rust and Node tests, renderer build, desktop check and Windows smoke test.

### Task 5: Review and delivery

**Files:** README and execution record below.

- [x] Review changes against both specs and resolve important defects.
- [x] Document native startup/build, model downloads and platform limits.
- [x] Run formatter, Rust checks/tests, Node contract tests and renderer build. Report actual smoke-test results; do not equate compilation with dictation verification.

## Execution record

- User said “start implement”; treat as authorization to execute the discussed design without another approval round.
- No app-repository commits or pushes requested. Leave reviewable changes in the working tree.
- Speech agent owns only `crates/ququ-speech/**`; parent owns desktop/frontend/build integration.
- Desktop database tests: 2 passed, including legacy backup/restart and invalid pagination/text. SQLite tests were added with the implementation rather than observed red first; this deviates from the planned test-first step.
- Frontend tests: 11 passed, including listener cleanup, codecs, cross-window model state, language capability choices and Windows PATH handling. Renderer production build passed.
- Windows `cargo check` and executable `cargo build` passed. Static CRT is configured to match upstream sherpa-onnx /MT archives.
- Independent review found three important defects (history closing, unsupported language choices, cross-window download state); all were fixed and the reviewer verified the changes.
- Final desktop tests: 11 Node tests and 3 Rust tests passed. The added concurrency regression test reproduced malformed JSON log lines before a global writer lock fixed the issue.
- `cargo clippy --lib -- -D warnings` and `cargo fmt --check` passed. `npm run build:rust -- --debug --no-bundle` produced the Windows executable with embedded production renderer assets.
- Actual WebView2/CDP smoke passed: main React render, Tauri IPC/version, SenseVoice settings UI, history close/destroy/reopen. Screenshots were inspected. A test initially used the wrong history root selector and was corrected after inspecting the actual page; it was not an application defect.
- Speech agent verified 14 Rust tests and an opt-in model-backed SenseVoice test (repeat recognition, punctuation/VAD off, silence, switch rollback, shutdown). Optional Paraformer inference and macOS remain unverified. An NSIS installer has not yet been built/tested.
- User additionally requested a public architecture drawing via cfdrop-persist. A mobile-tested page is prepared; permanent upload is awaiting Cloudflare R2 credentials, which are not configured on this workstation.
