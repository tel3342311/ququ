#[path = "keyboard/mod.rs"]
mod keyboard;
use keyboard::machine::{Action, Machine};
#[cfg(windows)]
use keyboard::windows as platform;
#[cfg(target_os = "macos")]
use keyboard::macos as platform;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum HotkeyMode {
    #[default]
    Toggle,
    Hold,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HotkeyConfig {
    pub key: String,
    #[serde(default)]
    pub mode: HotkeyMode,
}
#[derive(Clone, Debug)]
enum Binding {
    Single(u32),
    Chord(Shortcut),
}
#[derive(Default)]
struct State {
    config: Option<HotkeyConfig>,
    binding: Option<Binding>,
    capture: bool,
    recording: bool,
    machine: Machine,
    pressed: Vec<bool>,
    chord_down: bool,
    hold_started: bool,
    #[cfg(any(windows, target_os = "macos"))]
    physical_activation: u32,
}
pub struct HotkeyManager {
    app: AppHandle,
    state: Arc<Mutex<State>>,
    operation: Mutex<()>,
    #[cfg(any(windows, target_os = "macos"))]
    _hook: Option<platform::Hook>,
    #[cfg(any(windows, target_os = "macos"))]
    hook_error: Option<String>,
    #[cfg(any(windows, target_os = "macos"))]
    worker: Option<std::thread::JoinHandle<()>>,
}
fn emit(app: &AppHandle, action: Action) {
    if let Some(main) = app.get_webview_window("main") {
        let action = match action {
            Action::Toggle => "toggle",
            Action::Start => "start",
            Action::Stop => "stop",
            Action::Cancel => "cancel",
        };
        let _ = main.emit(
            "hotkey-triggered",
            serde_json::json!({"action":action,"source":"global"}),
        );
    }
}
fn single(key: &str) -> Option<u32> {
    #[cfg(windows)]
    match key {
        "ControlLeft" => Some(0xA2),
        "ControlRight" => Some(0xA3),
        "ShiftLeft" => Some(0xA0),
        "ShiftRight" => Some(0xA1),
        "AltLeft" => Some(0xA4),
        "AltRight" => Some(0xA5),
        "MetaLeft" => Some(0x5B),
        "MetaRight" => Some(0x5C),
        _ => None,
    }
    #[cfg(target_os = "macos")]
    match key {
        "ControlLeft" => Some(keyboard::macos::KEY_CONTROL_LEFT),
        "ControlRight" => Some(keyboard::macos::KEY_CONTROL_RIGHT),
        "ShiftLeft" => Some(keyboard::macos::KEY_SHIFT_LEFT),
        "ShiftRight" => Some(keyboard::macos::KEY_SHIFT_RIGHT),
        "AltLeft" => Some(keyboard::macos::KEY_ALT_LEFT),
        "AltRight" => Some(keyboard::macos::KEY_ALT_RIGHT),
        "MetaLeft" => Some(keyboard::macos::KEY_COMMAND_LEFT),
        "MetaRight" => Some(keyboard::macos::KEY_COMMAND_RIGHT),
        _ => None,
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    match key {
        "ControlLeft" | "ControlRight" | "ShiftLeft" | "ShiftRight" | "AltLeft" | "AltRight"
        | "MetaLeft" | "MetaRight" => Some(0),
        _ => None,
    }
}
fn parse(key: &str) -> Result<Binding, String> {
    if let Some(vk) = single(key) {
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = vk;
            return Err("Single modifier hotkeys are currently supported on Windows only. Use a key combination on this platform.".into());
        }
        #[cfg(any(windows, target_os = "macos"))]
        return Ok(Binding::Single(vk));
    }
    let shortcut = key
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid hotkey: {e}"))?;
    // Unmodified typing keys would be swallowed system-wide. Only function keys
    // can be registered alone; combinations must include a real modifier.
    if shortcut.mods.is_empty()
        && !(shortcut
            .key
            .to_string()
            .strip_prefix('F')
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| (1..=24).contains(&n)))
    {
        return Err(
            "Choose a modifier combination, a function key, or a left/right modifier key.".into(),
        );
    }
    Ok(Binding::Chord(shortcut))
}
impl HotkeyManager {
    pub fn new(app: AppHandle) -> Result<Self, String> {
        let mut initial = State {
            pressed: vec![false; 256],
            ..State::default()
        };
        #[cfg(windows)]
        for (vk, down) in initial.pressed.iter_mut().enumerate() {
            // Hooks report sided modifier VKs; their generic aliases never
            // receive a matching release and must not enter our pressed set.
            *down = !matches!(vk, 0x10..=0x12)
                && unsafe {
                    windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(vk as i32) < 0
                };
        }
        #[cfg(target_os = "macos")]
        for (key, down) in initial.pressed.iter_mut().enumerate() {
            if key < 128 {
                *down = keyboard::macos::is_key_down(key as u16);
            }
        }
        let state = Arc::new(Mutex::new(initial));
        #[cfg(any(windows, target_os = "macos"))]
        let hook_result =
            (|| -> Result<(platform::Hook, std::thread::JoinHandle<()>), String> {
                let (hook, rx) = platform::Hook::start()?;
                let state = Arc::clone(&state);
                let app = app.clone();
                let worker = std::thread::Builder::new()
                    .name("ququ-hotkey-events".into())
                    .spawn(move || {
                        while let Ok(input) = rx.recv() {
                            let Ok(mut s) = state.lock() else { break };
                            let action = {
                                let idx = input.key as usize;
                                if idx >= 256 {
                                    continue;
                                }
                                let repeated = input.pressed && s.pressed[idx];
                                s.pressed[idx] = input.pressed;
                                if repeated {
                                    continue;
                                }
                                if s.capture || input.captured {
                                    continue;
                                }
                                if let Some(Binding::Single(vk)) = s.binding {
                                    if s.recording
                                        && s.machine.hold
                                        && input.key == vk
                                        && input.pressed
                                    {
                                        continue;
                                    }
                                    let other = s
                                        .pressed
                                        .iter()
                                        .enumerate()
                                        .any(|(i, down)| *down && i != vk as usize);
                                    s.machine.key(input.key == vk, input.pressed, false, other)
                                } else {
                                    None
                                }
                            };
                            if let Some(action) = action {
                                emit(&app, action);
                            }
                        }
                    })
                    .map_err(|e| e.to_string())?;
                Ok((hook, worker))
            })();
        #[cfg(any(windows, target_os = "macos"))]
        let (hook, worker, hook_error) = match hook_result {
            Ok((hook, worker)) => (Some(hook), Some(worker), None),
            Err(error) => (None, None, Some(error)),
        };
        Ok(Self {
            app,
            state,
            operation: Mutex::new(()),
            #[cfg(any(windows, target_os = "macos"))]
            _hook: hook,
            #[cfg(any(windows, target_os = "macos"))]
            hook_error,
            #[cfg(any(windows, target_os = "macos"))]
            worker,
        })
    }
    pub fn current(&self) -> Result<Option<HotkeyConfig>, String> {
        Ok(self.state.lock().map_err(|e| e.to_string())?.config.clone())
    }
    pub fn configure(&self, config: HotkeyConfig) -> Result<(), String> {
        let binding = parse(config.key.trim())?;
        #[cfg(any(windows, target_os = "macos"))]
        if matches!(binding, Binding::Single(_)) {
            if let Some(error) = &self.hook_error {
                return Err(error.clone());
            }
        }
        let _operation = self.operation.lock().map_err(|e| e.to_string())?;
        let old = self
            .state
            .lock()
            .map_err(|e| e.to_string())?
            .binding
            .clone();
        let same =
            matches!((&old,&binding),(Some(Binding::Chord(a)),Binding::Chord(b)) if a.id()==b.id());
        if let Binding::Chord(shortcut) = &binding {
            if !same {
                let state = Arc::clone(&self.state);
                let expected = shortcut.id();
                #[cfg(any(windows, target_os = "macos"))]
                let provenance = self._hook.as_ref().map(|hook| hook.provenance());
                self.app.global_shortcut().on_shortcut(*shortcut,move |app,_,event| {
                    let Ok(mut s)=state.lock() else {return};
                    if s.capture || !matches!(s.binding.as_ref(),Some(Binding::Chord(key)) if key.id()==expected) {return;}
                    let pressed=event.state==ShortcutState::Pressed;
                    #[cfg(any(windows, target_os = "macos"))]
                    if pressed {
                        if let Some(provenance)=&provenance {
                            let count=provenance.count();
                            if count==s.physical_activation {return;}
                            s.physical_activation=count;
                        }
                    }
                    let action=if pressed {
                        if s.chord_down {return;}
                        s.chord_down=true;
                        if s.config.as_ref().is_some_and(|c|c.mode==HotkeyMode::Hold) {
                            if s.recording {None} else {s.hold_started=true;Some(Action::Start)}
                        } else {Some(Action::Toggle)}
                    } else {
                        s.chord_down=false;
                        if s.hold_started {s.hold_started=false;Some(Action::Stop)} else {None}
                    };
                    if let Some(action)=action {emit(app,action);}
                }).map_err(|e|e.to_string())?;
            }
        }
        if !same {
            if let Some(Binding::Chord(old)) = &old {
                if let Err(error) = self.app.global_shortcut().unregister(*old) {
                    if let Binding::Chord(new) = &binding {
                        let _ = self.app.global_shortcut().unregister(*new);
                    }
                    return Err(error.to_string());
                }
            }
        }
        {
            let mut s = self.state.lock().map_err(|e| e.to_string())?;
            let cancel = s.machine.suspend().is_some() || s.hold_started;
            s.config = Some(config.clone());
            s.binding = Some(binding);
            #[cfg(any(windows, target_os = "macos"))]
            if let Some(hook) = &self._hook {
                let (vk, mods) = match &s.binding {
                    Some(Binding::Chord(key)) => {
                        use tauri_plugin_global_shortcut::Modifiers;
                        let mods = u32::from(key.mods.contains(Modifiers::SHIFT))
                            | (u32::from(key.mods.contains(Modifiers::CONTROL)) << 1)
                            | (u32::from(key.mods.contains(Modifiers::ALT)) << 2)
                            | (u32::from(key.mods.intersects(Modifiers::SUPER | Modifiers::META))
                                << 3);
                        (
                            keyboard::keycodes::key_to_vk(&key.key).unwrap_or(0) as u32,
                            mods,
                        )
                    }
                    _ => (0, 0),
                };
                s.physical_activation = hook.provenance().configure(vk, mods);
            }
            s.machine = Machine::default();
            s.machine.hold = config.mode == HotkeyMode::Hold;
            s.chord_down = false;
            #[cfg(any(windows, target_os = "macos"))]
            if let Some(hook) = &self._hook {
                s.physical_activation = hook.provenance().count();
            }
            s.hold_started = false;
            if cancel {
                emit(&self.app, Action::Cancel);
            }
        }
        Ok(())
    }
    pub fn set_capture(&self, capture: bool) {
        if let Ok(mut s) = self.state.lock() {
            s.capture = capture;
            s.chord_down = false;
            #[cfg(any(windows, target_os = "macos"))]
            if let Some(hook) = &self._hook {
                hook.provenance().set_capture(capture);
                s.physical_activation = hook.provenance().count();
            }
            if capture {
                let cancel = s.machine.suspend().is_some() || s.hold_started;
                s.hold_started = false;
                if cancel {
                    emit(&self.app, Action::Cancel);
                }
            }
        }
    }
    pub fn set_recording(&self, recording: bool) {
        if let Ok(mut s) = self.state.lock() {
            s.recording = recording;
        }
    }
    pub fn unregister(&self) -> Result<(), String> {
        let _operation = self.operation.lock().map_err(|e| e.to_string())?;
        let old = self
            .state
            .lock()
            .map_err(|e| e.to_string())?
            .binding
            .clone();
        if let Some(Binding::Chord(key)) = old {
            self.app
                .global_shortcut()
                .unregister(key)
                .map_err(|e| e.to_string())?;
        }
        {
            let mut s = self.state.lock().map_err(|e| e.to_string())?;
            let cancel = s.machine.suspend().is_some() || s.hold_started;
            s.config = None;
            s.binding = None;
            s.hold_started = false;
            s.chord_down = false;
            if cancel {
                emit(&self.app, Action::Cancel);
            }
        }
        Ok(())
    }
}

impl Drop for HotkeyManager {
    fn drop(&mut self) {
        let _ = self.unregister();
        #[cfg(any(windows, target_os = "macos"))]
        {
            // Closing the hook drops the channel sender before joining its worker.
            drop(self._hook.take());
            if let Some(worker) = self.worker.take() {
                let _ = worker.join();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_unmodified_typing_keys_but_accept_function_keys() {
        for key in ["A", "KeyA", "Space", "Enter", "Digit1"] {
            assert!(parse(key).is_err(), "{key}");
        }
        for key in ["F2", "f2", "Control+Shift+Space"] {
            assert!(parse(key).is_ok(), "{key}");
        }
    }
    #[test]
    fn config_roundtrips_modes_and_defaults_to_toggle() {
        let config: HotkeyConfig = serde_json::from_str(r#"{"key":"ControlLeft"}"#).unwrap();
        assert_eq!(config.mode, HotkeyMode::Toggle);
        let hold = HotkeyConfig {
            key: "ControlRight".into(),
            mode: HotkeyMode::Hold,
        };
        assert_eq!(
            serde_json::to_value(&hold).unwrap(),
            serde_json::json!({"key":"ControlRight","mode":"hold"})
        );
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn single_modifiers_parse_on_macos() {
        let cases = [
            ("ControlLeft", keyboard::macos::KEY_CONTROL_LEFT),
            ("ControlRight", keyboard::macos::KEY_CONTROL_RIGHT),
            ("ShiftLeft", keyboard::macos::KEY_SHIFT_LEFT),
            ("ShiftRight", keyboard::macos::KEY_SHIFT_RIGHT),
            ("AltLeft", keyboard::macos::KEY_ALT_LEFT),
            ("AltRight", keyboard::macos::KEY_ALT_RIGHT),
            ("MetaLeft", keyboard::macos::KEY_COMMAND_LEFT),
            ("MetaRight", keyboard::macos::KEY_COMMAND_RIGHT),
        ];
        for (name, expected_vk) in cases {
            match parse(name) {
                Ok(Binding::Single(vk)) => assert_eq!(vk, expected_vk, "{name}"),
                other => panic!("expected Binding::Single({expected_vk}) for {name}, got {other:?}"),
            }
        }
    }
    #[test]
    #[cfg(not(any(windows, target_os = "macos")))]
    fn single_modifiers_fail_on_linux_with_platform_message() {
        for key in ["ControlLeft", "AltRight", "MetaLeft"] {
            assert_eq!(
                parse(key).err().as_deref(),
                Some("Single modifier hotkeys are currently supported on Windows only. Use a key combination on this platform.")
            );
        }
    }
}
