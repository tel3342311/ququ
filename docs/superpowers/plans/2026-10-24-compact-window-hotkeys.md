# Compact dictation window and configurable hotkeys

> Execute inline for window/frontend integration; the independent native hotkey module is delegated under superpowers:dispatching-parallel-agents.

**Goal:** Replace the distracting native main window with a tiny recording indicator and provide persisted configurable recording keys.

**Architecture:** The hidden React main entry owns recording and background transcription. Rust manages an unfocusable click-through indicator, placement and global keys. Settings/history remain separate normal windows opened from the tray.

## Agreed requirements

- Small rectangle containing a stable red recording dot, rather than the existing 400×500 interface.
- Gentle fade in/out, no large flashes, remain near the cursor and minimize dictation interruption.
- Configurable hotkey; a single left Control key is an example, not a hardcoded requirement.
- Preserve the completed theme fix in all windows.
- User said “go”; implement without another confirmation round.

## Builder defaults stated to the user

- Indicator 76×28 logical pixels, 8-pixel dot, 180 ms fade; honor reduced motion.
- Hidden at startup and after recording. Processing/pasting remains in the background.
- Try Windows native caret coordinates, fall back to the mouse when unavailable; keep inside the monitor work area.
- Default recording mode remains toggle; both toggle and hold modes are configurable.
- Never activate the indicator or steal keyboard focus. Settings/history open from the tray.
- Windows first. Regular chord shortcuts retain cross-platform support; unsupported platform-specific single keys must report an honest error.

## File ownership and interfaces

Parent: `src-tauri/src/{lib,indicator,windows}.rs`, Cargo/config changes, React recording controller, compact component and hotkey settings/capture UI.

Hotkey worker: `src-tauri/src/shortcuts.rs` and new `src-tauri/src/keyboard/**` only. Parent integrates a `HotkeyManager` into AppState. Proposed interface: `new(AppHandle)`, `configure(HotkeyConfig)`, `current()`, `set_capture(bool)`, `set_recording(bool)`, `unregister()`; worker confirms exact signatures before integration. Events on main only: `hotkey-triggered` payload `{action: "toggle"|"start"|"stop"|"cancel", source:"global"}`. Worker never shows/focuses the main window.

## Tasks

- [x] Test recording cancellation and rapid start/stop intent, then fix the existing cancel path so cancelled audio cannot transcribe, save or paste.
- [x] Implement native hotkey state machine and Windows single-modifier support; ignore injected input, repeats and ordinary modifier chords. Configuration changes are atomic and capture temporarily suspends triggers.
- [x] Test indicator placement/clamping; add caret/mouse placement, no activation, click-through and generation-safe fade-out hiding.
- [x] Implement compact native React root; preserve Electron fallback; hide transcript text and send final text through the existing save/AI/paste flow exactly once.
- [x] Add keyboard capture, configurable trigger mode, persistence and registration-error feedback in Settings. Never overwrite the saved choice on startup.
- [x] Run Node/Rust tests, production renderer/native build, headless visual checks and real native window/settings smoke. Review changes and launch the updated app.

## Important checks

- Ctrl+C/V and injected paste keys must not accidentally start recording.
- A cancelled/pending microphone permission request must not restart recording afterward.
- An old fade-out timer must not hide a newly started recording.
- Editing/cancelling shortcuts must restore the active shortcut, including when Settings closes.
- Indicator remains in bounds across negative-coordinate monitors and DPI scaling.
- Main-window recording state remains owned by main; settings/history cannot record.

No application commits or pushes are requested. Keep reviewable changes in this existing isolated worktree.


## Verification results

- Node: 27 passed. Rust desktop: 14 passed, one opt-in native hook test ignored by default; that Windows hook lifecycle test also passed explicitly.
- Clippy all targets with warnings denied passed.
- Headless compact UI verifies 76×28, constant red dot, toggle, cancellation, one save/paste and fade. Theme checks pass in light/dark and on live system theme changes.
- Native WebView2 smoke verifies the real capture UI, Save, reload persistence, invalid key rejection without losing the active key, restoration of original configuration, SenseVoice settings and history recreation.
- Review corrected foreground-validation timing and stale fade timers. Native size checking exposed Windows minimum track sizing; explicit min/max dimensions plus clearing retained Windows caption styles now constrain the overlay. A native style/size probe verified the fix without changing the foreground window.
- User microphone quality and physical hotkey feel are not simulated by the automated tests.
