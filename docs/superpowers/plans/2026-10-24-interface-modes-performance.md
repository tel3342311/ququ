# Classic/Compact Modes and Performance Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for isolated tasks and a final review.

**Goal:** Restore the original-style Classic UI beside Compact, persist switching in Settings/tray, and report real local performance evidence.
**Architecture:** One always-mounted native React recording controller serves both views. Rust owns mode persistence, window sizing/focus policy and busy-state rejection. Existing Electron fallback remains. Timings contain numbers only; ASR baseline is separate from UI and cloud latency.
**Tech Stack:** React/Tailwind, Tauri 2, Rust/sherpa-onnx, Node tests and WebView2 smoke.
**Spec:** Approved Lavish feedback in `.lavish/interface-modes-performance.html`: settings-and-tray, new-install Classic; retain original layout and Compact behavior.

## Constraints
- Preserve original colors/layout, configurable hotkeys, shared history and single save/paste.
- No mode switch during starting/recording/processing/optimizing. Window mode changes never reload the recording owner.
- New installs default Classic. An installation lacking mode but with native dictation_hotkey retains Compact as migration rule; record this builder choice.
- Compact stays click-through/nonactivating; Classic is interactive, remembers location, tray restores it. Close hides to tray.
- No app commits/pushes; use existing isolated worktree.

## Tasks and ownership
- [x] Native implementer owns `src-tauri/src/{lib,indicator,interface}.rs`, config: mode/state commands, persisted migration, tray check items, window transitions, debug verification fields. Rust tests red/green.
- [x] Parent owns React root/controller/Classic and InterfaceSettings, bridge, CSS, browser tests: one recording owner, original-style microphone/status/results/history/settings, collapse button, mode events, failure display and frontend busy guard.
- [x] Performance implementer owns `src/desktop/{dictation,performance}*.mjs`, Rust speech example and benchmark script: numerical phase timings, deterministic tests and real SenseVoice baseline with honest scope.
- [x] Parent integrates, executes Node/Rust/clippy/renderer/native checks, validates native switches/persistence/busy rejection/focus, independent final review, rebuilds and launches normally.

## Review focus
- Late mode read/event races must not reset latest selection; switches never remount or duplicate recorder.
- Pending microphone permission and AI work count as busy, not merely actual recording.
- Rust hidden caption styles are removed for Compact and size/focus policy restored for Classic.
- Old fade timer and placement worker cannot move/hide Classic after switching.
- Paste targets captured external editor; Classic button/tray activation must not paste into app itself.
- Metrics include failures and separate model-load, local recognition, AI, audio preparation, save and paste; no invented UI A/B or accuracy results.

## Ledger
Ruling: Treat the approved mode choice as implementation authorization; performance work supplies instrumentation and a local ASR baseline, not a claim of completed corpus/UI A/B benchmarking.
Ruling: Retain Compact on native installations identified by dictation_hotkey; new empty databases select Classic. Cost if wrong: user can change once in Settings.


## Verification
- 40 Node tests passed; browser Classic/Compact tests verify one microphone/save/paste, retained result, saved selection and busy rejection. Compact and theme regressions also pass.
- Rust desktop 16 passed, one opt-in native hook test remains ignored by default (previously exercised). Clippy all targets with warnings denied passed. Native bundled-assets debug build passed.
- Actual WebView2 smoke verifies native modes/sizing/focus policy, settings selection/reload, all four busy phases, collapse, hotkey capture/mode/save/invalid rejection, history close/reopen; restores original preferences.
- Review fixes: await native event-listener readiness before initial mode read; audio preparation failures/cancellation emit one numeric report; entire native mode transitions execute on the UI thread to avoid IPC/tray lock inversion; failed tray switch restores checkmarks and provides feedback; persistence/apply failure rolls back window policy.
- Real ASR-only baseline: verified 5.592s WAV, 30/30 warm runs, p50 606.8625ms, p95 684.9642ms. Model verification 5451.5599ms and process-cold initialization4913.7176ms measured separately. No claim of UI A/B, corpus accuracy, cloud or paste benchmark.
- Baseline report and reproducible script are in docs/performance-baseline.md and scripts/benchmark-local-asr.ps1. App remains uncommitted in this existing worktree.


## Later Compact presentation updates
User requested a fixed position beside the mouse: sample the mouse once at recording start, do not continue following it or the caret. The user then requested a breathing red dot beside the literal “Recording...” label. Current Compact dimensions are 160×32 logical pixels in CSS and native placement/sizing; reduced-motion disables breathing. Screen-edge tests and browser animation/text-fit checks cover the new dimensions.
