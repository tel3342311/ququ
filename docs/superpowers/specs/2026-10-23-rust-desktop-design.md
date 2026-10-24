# QuQu Rust desktop migration

Status: approved for implementation by the user's “start implement” instruction; Windows validation in progress.

## Intent and scope

The user requested a Rust rewrite, agreed to start with the Electron/React portion, and explicitly delegated replacement of Python with Rust to a subagent. Keep the existing React screens and migrate the Electron host to Rust. Develop the native speech engine as a separate workstream; its inference backend and model compatibility require evidence before selection.

## Proposed architecture (builder decisions)

Use Tauri 2 with the existing React/Vite frontend. Place the Rust desktop host in `src-tauri/`; keep Vite rooted at `src/` with output at `src/dist/`. Preserve the main, control, history, and settings windows and their existing entry points. Preserve frameless dictation window behavior, visibility controls, tray actions, global shortcuts, and recording-state synchronization.

Introduce a frontend desktop adapter loaded before each React entry point. Initially preserve the `window.electronAPI` contract so components and hooks keep their expected argument, return, and event shapes. Explicitly map methods to Tauri commands; do not expose arbitrary shell execution or generic filesystem access. Event registration must return synchronous cleanup functions, including when registration completes asynchronously.

Rust services own SQLite access, settings, AI HTTP requests, clipboard and paste integration, application lifecycle, structured JSON logs, shortcuts, model lifecycle and speech execution. React continues microphone capture and WAV conversion initially. Check WebView recording codec support rather than assuming Chromium-only formats work on every OS.

Use a Rust SQLite library with the existing tables and JSON-serialized settings. The legacy database is `transcriptions.db` inside `%USERPROFILE%/AppData/Roaming/蛐蛐` on Windows, `~/Library/Application Support/蛐蛐` on macOS, and `~/.config/蛐蛐` on Linux (`EnvironmentManager.getDataDirectory`). Preserve or explicitly migrate it with a backup before writing. Keep raw and processed transcription text, metadata, pagination and deletion semantics. Never silently start with an empty database when legacy data exists.

Preserve AI processing modes and configured endpoint/model behavior. Keep credentials out of logs. Native HTTP requests avoid browser CORS differences. Preserve application and speech logs separately in the user data directory.

## Parallel speech workstream

The delegated speech design must establish whether existing FunASR artifacts can run with a Rust runtime, whether export is needed, and which model changes alter transcription results. ASR, VAD and punctuation are all required capabilities. Model download must support progress, missing-model states, integrity checks, interruption and retry. No claim of a Python-free rewrite is valid while Python is still required at runtime.

The user additionally requested SenseVoice. Include SenseVoice as a selectable ASR engine in settings and model management, with independent model readiness, download progress and language configuration. The speech workstream verifies the official sherpa-onnx Rust SenseVoice route and records its VAD/punctuation behavior. Adding SenseVoice does not silently replace an existing engine selection or establish transcription parity with Paraformer. See `2026-10-23-rust-speech-engine-design.md` for model details.

Define a Rust speech service interface with status, transcribe, download, progress and shutdown operations. Preserve frontend response shapes through the desktop adapter. A temporary Python bridge may support incremental desktop development, but must be labeled transitional and cannot count as completion of the requested Python replacement.

## Delivery order

1. Inventory actual frontend API consumers against registered Electron handlers; flag pre-existing placeholders separately.
2. Add the Tauri host, scoped capabilities, frontend adapter and development/build commands alongside the working Electron path.
3. Port settings/history and window management, then clipboard, shortcuts, tray, AI requests and logs.
4. Integrate the approved native speech design and model management.
5. Validate end-to-end dictation, restart behavior, database continuity and packaged resource paths before making Rust the default and removing obsolete Electron/Python runtime dependencies.

The user confirmed the platform order through Lavish: Windows first, then macOS. Deliver and validate the Windows application before the macOS packaging, permissions, shortcuts and paste integration pass. Linux is outside the initial delivery milestones; preserve portable code paths where practical and do not claim Linux support without validation. Existing Electron remains available until the replacement works.

## Acceptance and verification

- React main/control/history/settings screens load through Tauri in development and a production renderer build.
- Settings and history persist across restart; existing data is retained.
- Shortcuts trigger one recording owner, stop correctly, and unregister without listener leaks.
- Record, transcribe, optionally optimize, save and paste complete end to end; user-facing errors identify missing models and runtime failures.
- Speech work does not block the UI and cleans up on shutdown. Failed downloads do not masquerade as complete models.
- Rust tests cover database compatibility, protocol/adapter contracts and relevant speech lifecycle behavior. Run formatter, Rust checks/tests and renderer build; report exact environmental gaps.
- A packaged Windows smoke test verifies resources and microphone access. macOS permission behavior and Linux desktop integration require their own platform verification.

## Known environment constraints

Initial PATH inspection found neither Cargo nor pnpm. Check installed locations before installing tools; dependency downloads and writes outside the workspace may require sandbox approval. This is not yet a verified build environment.

## Design review

An independent builder review found no material unanswered desktop planning questions. Speech backend and model compatibility remain explicitly assigned to the separate speech design, which must be integrated before final Python removal is planned.

## References

- https://v2.tauri.app/start/frontend/vite/
- https://v2.tauri.app/develop/calling-rust/
