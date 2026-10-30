mod ai;
mod clipboard;
mod database;
mod indicator;
mod interface;
mod logging;
mod shortcuts;
mod windows;

use ququ_speech::{Engine, SpeechService, TranscribeOptions};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

pub struct AppState {
    db: Mutex<database::Database>,
    speech: Arc<SpeechService>,
    data_dir: PathBuf,
    progress: Arc<Mutex<Value>>,
    hotkeys: shortcuts::HotkeyManager,
    indicator: indicator::Indicator,
    recording: AtomicBool,
    interface: Mutex<interface::Interface>,
}
impl AppState {
    fn database(&self) -> Result<std::sync::MutexGuard<'_, database::Database>, String> {
        self.db.lock().map_err(|e| e.to_string())
    }
}
fn arg(args: &[Value], index: usize) -> Value {
    args.get(index).cloned().unwrap_or(Value::Null)
}
fn text(args: &[Value], index: usize) -> Result<&str, String> {
    args.get(index)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Argument {index} must be text"))
}
fn engine(value: &str) -> Result<Engine, String> {
    value
        .parse()
        .map_err(|e: ququ_speech::SpeechError| e.to_string())
}
fn selected(state: &AppState) -> Result<Engine, String> {
    engine(
        state
            .database()?
            .get("speech_engine", json!("sensevoice"))?
            .as_str()
            .unwrap_or("sensevoice"),
    )
}
fn value<T: serde::Serialize>(data: T) -> Result<Value, String> {
    serde_json::to_value(data).map_err(|e| e.to_string())
}

fn publish_model_ready(app: &AppHandle, engine: Engine) -> Result<(), String> {
    app.emit(
        "settings-update",
        json!({"key":"speech_engine","value":engine}),
    )
    .map_err(|e| e.to_string())?;
    app.emit("processing-update", json!({"type":"model_initialization","isLoading":false,"isReady":true,"progress":100,"engine":engine})).map_err(|e|e.to_string())
}

#[tauri::command]
async fn desktop_command(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    action: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    match action.as_str() {
        "get-interface-mode" => Ok(json!(state
            .interface
            .lock()
            .map_err(|e| e.to_string())?
            .mode
            .name())),
        "set-interface-mode" => {
            dispatch_interface_mode(&app, text(&args, 0)?).await?;
            Ok(json!({"success":true}))
        }
        "set-dictation-phase" => {
            if window.label() != "main" {
                return Err("Only dictation window owns phase".into());
            }
            let phase = text(&args, 0)?;
            state
                .interface
                .lock()
                .map_err(|e| e.to_string())?
                .set_phase(phase)?;
            if phase == "starting" {
                state.indicator.capture_target();
            }
            Ok(json!({"success":true}))
        }
        "get-setting" => state.database()?.get(text(&args, 0)?, arg(&args, 1)),
        "get-settings" | "get-all-settings" => state.database()?.all_settings(),
        "set-setting" | "save-setting" => {
            let key = text(&args, 0)?;
            let data = arg(&args, 1);
            if key == "interface_mode" {
                dispatch_interface_mode(&app, data.as_str().ok_or("Invalid mode")?).await?;
                return Ok(json!({"success":true}));
            }
            if key == "speech_engine" {
                engine(data.as_str().ok_or("Invalid engine")?)?;
            }
            if key == "speech_language"
                && !["auto", "zh", "yue", "en", "ja", "ko"].contains(&data.as_str().unwrap_or(""))
            {
                return Err("Unsupported speech language".into());
            }
            let result = state.database()?.set(key, &data)?;
            app.emit("settings-update", json!({"key":key,"value":data}))
                .map_err(|e| e.to_string())?;
            Ok(result)
        }
        "reset-settings" => state.database()?.reset(),
        "save-transcription" => {
            let result = state.database()?.save(&arg(&args, 0))?;
            app.emit("transcription-update", &result)
                .map_err(|e| e.to_string())?;
            Ok(result)
        }
        "get-transcriptions" => state.database()?.list(
            arg(&args, 0).as_i64().unwrap_or(50),
            arg(&args, 1).as_i64().unwrap_or(0),
        ),
        "delete-transcription" => state
            .database()?
            .delete(arg(&args, 0).as_i64().ok_or("Invalid ID")?),
        "clear-all-transcriptions" => state.database()?.clear(),
        "update-transcription" => {
            let id = arg(&args, 0).as_i64().ok_or("Invalid ID")?;
            let updated_text = text(&args, 1)?;
            let result = state
                .database()?
                .update_transcription_text(id, updated_text)?;
            app.emit(
                "transcription-update",
                json!({"id": id, "text": updated_text}),
            )
            .map_err(|e| e.to_string())?;
            Ok(result)
        }
        "get-special-words" => {
            let mut words = state.database()?.get_special_words()?;
            if let Some(items) = words.as_array_mut() {
                for item in items {
                    let matched = item
                        .get("word")
                        .and_then(Value::as_str)
                        .map(ququ_speech::to_traditional_tw);
                    if let (Some(matched), Some(obj)) = (matched, item.as_object_mut()) {
                        obj.insert("match_word".into(), json!(matched));
                    }
                }
            }
            Ok(words)
        }
        "save-special-word" => {
            let data = arg(&args, 0);
            let payload = if data.is_object() {
                data
            } else if let Some(w) = data.as_str() {
                json!({
                    "word": w,
                    "replacement": args.get(1).and_then(Value::as_str)
                })
            } else {
                return Err("Invalid special word data".into());
            };
            let result = state.database()?.save_special_word(&payload)?;
            app.emit("special-words-update", &result)
                .map_err(|e| e.to_string())?;
            Ok(result)
        }
        "delete-special-word" => {
            let target = arg(&args, 0);
            let result = if let Some(id) = target.as_i64() {
                state.database()?.delete_special_word(id)?
            } else if let Some(s) = target.as_str() {
                if let Ok(id) = s.parse::<i64>() {
                    state.database()?.delete_special_word(id)?
                } else {
                    state.database()?.delete_special_word_by_word(s)?
                }
            } else {
                return Err("Invalid ID or word".into());
            };
            app.emit("special-words-update", json!({"deleted": target}))
                .map_err(|e| e.to_string())?;
            Ok(result)
        }
        "export-special-words" => {
            let handle = app.clone();
            let path = tauri::async_runtime::spawn_blocking(move || {
                let file_path = handle
                    .dialog()
                    .file()
                    .set_file_name("special-words.json")
                    .add_filter("JSON (*.json)", &["json"])
                    .blocking_save_file();
                if let Some(fp) = file_path {
                    fp.into_path().map_err(|e| e.to_string()).map(Some)
                } else {
                    Ok(None)
                }
            })
            .await
            .map_err(|e| e.to_string())??;
            if let Some(path) = path {
                let content = state.database()?.export_special_words()?;
                std::fs::write(&path, &content).map_err(|e| e.to_string())?;
                Ok(json!({"success": true, "filePath": path.to_string_lossy().to_string()}))
            } else {
                Ok(json!({"success": false, "canceled": true}))
            }
        }
        "import-special-words" => {
            let handle = app.clone();
            let picked = tauri::async_runtime::spawn_blocking(move || {
                let file_path = handle
                    .dialog()
                    .file()
                    .add_filter("JSON (*.json)", &["json"])
                    .blocking_pick_file();
                if let Some(fp) = file_path {
                    fp.into_path().map_err(|e| e.to_string()).map(Some)
                } else {
                    Ok(None)
                }
            })
            .await
            .map_err(|e| e.to_string())??;
            let Some(path) = picked else {
                return Ok(json!({"success": false, "canceled": true}));
            };
            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
            let content = String::from_utf8(bytes).map_err(|_| "檔案編碼必須為 UTF-8".to_string())?;
            let file_path_str = Some(path.to_string_lossy().to_string());

            let summary = state.database()?.import_special_words(&content)?;
            let added = summary.get("added").and_then(Value::as_u64).unwrap_or(0);
            if added > 0 {
                app.emit("special-words-update", &summary)
                    .map_err(|e| e.to_string())?;
            }
            Ok(json!({
                "success": true,
                "filePath": file_path_str,
                "summary": summary
            }))
        }
        "hide-window" => {
            window.hide().map_err(|e| e.to_string())?;
            Ok(json!({"success":true}))
        }
        "show-window" => {
            window.show().map_err(|e| e.to_string())?;
            Ok(json!({"success":true}))
        }
        "minimize-window" => {
            window.minimize().map_err(|e| e.to_string())?;
            Ok(json!({"success":true}))
        }
        "close-window" => {
            window.hide().map_err(|e| e.to_string())?;
            Ok(json!({"success":true}))
        }
        "open-control-panel" | "open-history-window" | "open-settings-window" => {
            windows::open(
                &app,
                if action == "open-control-panel" {
                    "control"
                } else if action == "open-history-window" {
                    "history"
                } else {
                    "settings"
                },
            )?;
            Ok(json!({"success":true}))
        }
        "close-control-panel"
        | "close-history-window"
        | "hide-history-window"
        | "close-settings-window"
        | "hide-settings-window" => {
            let label = if action.contains("control") {
                "control"
            } else if action.contains("history") {
                "history"
            } else {
                "settings"
            };
            if let Some(target) = app.get_webview_window(label) {
                if action == "close-history-window" || action == "close-settings-window" {
                    target.close().map_err(|e| e.to_string())?;
                } else {
                    target.hide().map_err(|e| e.to_string())?;
                }
            }
            Ok(json!({"success":true}))
        }
        "copy-text" | "write-clipboard" => {
            clipboard::copy(text(&args, 0)?)?;
            Ok(json!({"success":true}))
        }
        "read-clipboard" => Ok(json!({"success":true,"text":clipboard::read()?})),
        "paste-text" => {
            let content = text(&args, 0)?.to_owned();
            state.indicator.prepare_paste();
            let guard = state.indicator.paste_guard();
            let target = state.indicator.target_window();
            // Hide only the dictation overlay to return focus to the user's editor.
            if window.label() == "main"
                && state.interface.lock().map_err(|e| e.to_string())?.mode
                    == interface::Mode::Compact
            {
                window.hide().map_err(|e| e.to_string())?;
            }
            tauri::async_runtime::spawn_blocking(move || clipboard::paste(&content, guard, target))
                .await
                .map_err(|e| e.to_string())??;
            Ok(json!({"success":true}))
        }
        "get-current-hotkey" => Ok(json!(state
            .hotkeys
            .current()?
            .map(|c| c.key)
            .unwrap_or_else(|| "CommandOrControl+Shift+Space".into()))),
        "get-hotkey-config" => value(state.hotkeys.current()?.unwrap_or_else(default_hotkey)),
        "get-hotkey-status" => {
            let mut status = state.hotkeys.status();
            status["desired"] = state.database()?.get("dictation_hotkey", Value::Null)?;
            Ok(status)
        }
        "open-system-permissions" => {
            if window.label() != "settings" {
                return Err("請從設定視窗開啟系統權限".into());
            }
            shortcuts::open_permission_settings(text(&args, 0)?)?;
            Ok(json!({"success":true}))
        }
        "set-hotkey-config" | "register-hotkey" => {
            if state.recording.load(Ordering::SeqCst) {
                return Err("Stop recording before changing the hotkey".into());
            }
            let config: shortcuts::HotkeyConfig = if action == "register-hotkey" {
                shortcuts::HotkeyConfig {
                    key: text(&args, 0)?.into(),
                    mode: shortcuts::HotkeyMode::Toggle,
                }
            } else {
                serde_json::from_value(arg(&args, 0)).map_err(|e| e.to_string())?
            };
            let previous = state.hotkeys.current()?;
            state.hotkeys.configure(config.clone())?;
            if let Err(error) = state.database()?.set("dictation_hotkey", &json!(config)) {
                if let Some(previous) = previous {
                    let _ = state.hotkeys.configure(previous);
                }
                return Err(error);
            }
            Ok(json!({"success":true}))
        }
        "begin-hotkey-capture" | "end-hotkey-capture" => {
            if window.label() != "settings" {
                return Err("Open settings to capture a hotkey".into());
            }
            if action == "begin-hotkey-capture" && state.recording.load(Ordering::SeqCst) {
                return Err("Stop recording before capturing a hotkey".into());
            }
            state.hotkeys.set_capture(action == "begin-hotkey-capture");
            Ok(json!({"success":true}))
        }
        "unregister-hotkey" => {
            if window.label() == "main" {
                state.hotkeys.unregister()?;
            }
            Ok(json!({"success":true}))
        }
        "invalidate-dictation" => {
            state.indicator.invalidate_paste();
            Ok(json!({"success":true}))
        }
        "report-dictation-error" => {
            let message = text(&args, 0)?;
            logging::write(&state.data_dir.join("logs"), "error", message)?;
            if let Some(tray) = app.tray_by_id("ququ") {
                let _ = tray.set_tooltip(Some(format!("蛐蛐：{message}")));
            }
            app.emit("dictation-error", json!({"message":message}))
                .map_err(|e| e.to_string())?;
            Ok(json!({"success":true}))
        }
        "set-recording-state" | "start-recording" | "stop-recording" => {
            if window.label() != "main" {
                return Err("Only dictation window owns recording".into());
            }
            let recording = if action == "set-recording-state" {
                arg(&args, 0).as_bool().ok_or("Invalid recording state")?
            } else {
                action == "start-recording"
            };
            state.hotkeys.set_recording(recording);
            if state.recording.swap(recording, Ordering::SeqCst) != recording {
                state.indicator.set_recording(&app, recording)?;
                sync_recording_tray(&app, recording);
            }
            Ok(json!({"success":true}))
        }
        "get-recording-state" => Ok(json!(state.recording.load(Ordering::SeqCst))),
        "process-text" | "check-ai-status" => {
            let config = if action == "check-ai-status" && arg(&args, 0).is_object() {
                arg(&args, 0)
            } else {
                state.database()?.all_settings()?
            };
            let result = ai::complete(
                config,
                if action == "process-text" {
                    text(&args, 0)?
                } else {
                    ""
                },
                args.get(1).and_then(Value::as_str).unwrap_or("optimize"),
                action == "check-ai-status",
            )
            .await;
            Ok(result
                .unwrap_or_else(|error| json!({"success":false,"available":false,"error":error})))
        }
        "get-available-models" => value(ququ_speech::available_models()),
        "get-current-model" => {
            Ok(json!({"success":true,"model":selected(&state)?,"engine":selected(&state)?}))
        }
        "check-model-files" | "check-funasr-status" => {
            let speech = state.speech.clone();
            let selected = selected(&state)?;
            let server = action == "check-funasr-status";
            tauri::async_runtime::spawn_blocking(move || {
                let mut status = value(speech.status(selected).map_err(|e| e.to_string())?)?;
                status["success"] = json!(true);
                status["models_initialized"] = status["initialized"].clone();
                status["server_ready"] = status["initialized"].clone();
                status["initializing"] = json!(false);
                status["available"] = json!(true);
                if server && status["models_downloaded"] == true && status["initialized"] != true {
                    match speech.switch_engine(selected) {
                        Ok(ready) => {
                            status = value(ready)?;
                            status["success"] = json!(true);
                            status["models_initialized"] = json!(true);
                            status["server_ready"] = json!(true);
                        }
                        Err(e) => {
                            status["error"] = json!(e.to_string());
                        }
                    }
                }
                Ok(status)
            })
            .await
            .map_err(|e| e.to_string())?
        }
        "get-download-progress" => Ok(state.progress.lock().map_err(|e| e.to_string())?.clone()),
        "download-models" => {
            let event_app = app.clone();
            let speech = state.speech.clone();
            let selected = if let Some(name) = args.first().and_then(Value::as_str) {
                engine(name)?
            } else {
                selected(&state)?
            };
            let progress = state.progress.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let result = speech.download_models(selected, |event| {
                    if let Ok(data) = serde_json::to_value(event) {
                        if let Ok(mut current) = progress.lock() {
                            *current = data.clone();
                        }
                        let _ = app.emit("model-download-progress", data);
                    }
                });
                match result {
                    Ok(_) => {
                        speech.switch_engine(selected).map_err(|e| e.to_string())?;
                        Ok(json!({"success":true}))
                    }
                    Err(error) => Ok(json!({"success":false,"error":error.to_string()})),
                }
            })
            .await
            .map_err(|e| e.to_string())?;
            if result.as_ref().is_ok_and(|data| data["success"] == true) {
                state.database()?.set("speech_engine", &json!(selected))?;
                publish_model_ready(&event_app, selected)?;
            }
            result
        }
        "switch-model" | "restart-funasr-server" => {
            let target = if action == "switch-model" {
                engine(text(&args, 0)?)?
            } else {
                selected(&state)?
            };
            let speech = state.speech.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                speech.switch_engine(target).map_err(|e| e.to_string())
            })
            .await
            .map_err(|e| e.to_string())?;
            match result {
                Ok(status) => {
                    state.database()?.set("speech_engine", &json!(target))?;
                    publish_model_ready(&app, target)?;
                    let mut data = value(status)?;
                    data["success"] = json!(true);
                    Ok(data)
                }
                Err(error) => Ok(json!({"success":false,"error":error})),
            }
        }
        "transcribe-audio" => {
            let bytes: Vec<u8> =
                serde_json::from_value(arg(&args, 0)).map_err(|e| e.to_string())?;
            if bytes.len() > 64 * 1024 * 1024 {
                return Err("Audio exceeds 64 MiB limit".into());
            }
            let selected = selected(&state)?;
            let language = state.database()?.get("speech_language", json!("zh"))?;
            let punc = state.database()?.get("sensevoice_use_itn", json!(true))?;
            let mut options: TranscribeOptions =
                serde_json::from_value(arg(&args, 1)).map_err(|e| e.to_string())?;
            if arg(&args, 1).get("language").is_none() {
                options.language = language.as_str().unwrap_or("zh").to_owned();
            }
            if arg(&args, 1).get("use_punc").is_none() {
                options.use_punc = punc.as_bool().unwrap_or(true);
            }
            let speech = state.speech.clone();
            let speech_logs = state.data_dir.join("logs");
            tauri::async_runtime::spawn_blocking(move || {
                if speech.current_engine() != selected {
                    speech.switch_engine(selected).map_err(|e| e.to_string())?;
                }
                match speech.transcribe_wav(&bytes, options) {
                    Ok(result) => {
                        let _ =
                            logging::speech(&speech_logs, "info", "Native transcription completed");
                        value(result)
                    }
                    Err(error) => {
                        let _ = logging::speech(&speech_logs, "error", &error.to_string());
                        Ok(json!({"success":false,"error":error.to_string()}))
                    }
                }
            })
            .await
            .map_err(|e| e.to_string())?
        }
        "get-app-version" => Ok(json!(app.package_info().version.to_string())),
        "get-system-info" | "get-debug-info" => {
            let mode = state.interface.lock().map_err(|e| e.to_string())?.mode;
            Ok(
                json!({"platform":std::env::consts::OS,"arch":std::env::consts::ARCH,"runtime":"tauri","dataDirectory":state.data_dir,"interfaceMode":mode.name(),"mainVisible":app.get_webview_window("main").and_then(|w| w.is_visible().ok()),"mainSize":app.get_webview_window("main").and_then(|w| w.inner_size().ok()),"mainFocusable":mode == interface::Mode::Classic}),
            )
        }
        "log" => {
            let message = args
                .get(1)
                .and_then(Value::as_str)
                .unwrap_or("Frontend log");
            // Do not persist renderer-supplied details, which may contain credentials.
            logging::write(
                &state.data_dir.join("logs"),
                args.first().and_then(Value::as_str).unwrap_or("info"),
                message,
            )?;
            Ok(Value::Null)
        }
        "export-transcriptions" => {
            let format = args.first().and_then(Value::as_str).unwrap_or("json");
            if !["json", "txt"].contains(&format) {
                return Err("Native export supports JSON and TXT".into());
            }
            let rows = state.database()?.list(10000, 0)?;
            let content = if format == "json" {
                serde_json::to_string_pretty(&rows).map_err(|e| e.to_string())?
            } else {
                rows.as_array()
                    .unwrap()
                    .iter()
                    .map(|v| v["text"].as_str().unwrap_or(""))
                    .collect::<Vec<_>>()
                    .join("\n\n")
            };
            let handle = app.clone();
            let extension = format.to_owned();
            tauri::async_runtime::spawn_blocking(move || {
                let path = handle
                    .dialog()
                    .file()
                    .set_file_name(format!("transcriptions.{extension}"))
                    .blocking_save_file();
                if let Some(path) = path {
                    let path = path.into_path().map_err(|e| e.to_string())?;
                    std::fs::write(&path, content).map_err(|e| e.to_string())?;
                    Ok(json!({"success":true,"filePath":path}))
                } else {
                    Ok(json!({"success":false,"canceled":true}))
                }
            })
            .await
            .map_err(|e| e.to_string())?
        }
        _ => Err(format!("Native capability not available: {action}")),
    }
}

fn data_directory() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Cannot locate home directory")?;
    #[cfg(target_os = "windows")]
    let path = home.join("AppData/Roaming/蛐蛐");
    #[cfg(target_os = "macos")]
    let path = home.join("Library/Application Support/蛐蛐");
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let path = home.join(".config/蛐蛐");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn default_hotkey() -> shortcuts::HotkeyConfig {
    shortcuts::HotkeyConfig {
        key: "CommandOrControl+Shift+Space".into(),
        mode: shortcuts::HotkeyMode::Toggle,
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = data_directory()?;
            let db = database::Database::open(&data_dir.join("transcriptions.db"))?;
            let speech = SpeechService::new(data_dir.join("models/sherpa-onnx"))?;
            let hotkeys = shortcuts::HotkeyManager::new(app.handle().clone())?;
            let stored = db.get("dictation_hotkey", Value::Null)?;
            let mode = interface::Mode::migrate(&db.get("interface_mode", Value::Null)?, &stored);
            db.set("interface_mode", &json!(mode.name()))?;
            let config = serde_json::from_value(stored).unwrap_or_else(|_| {
                let key = db
                    .get("global_hotkey", json!("CommandOrControl+Shift+Space"))
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .unwrap_or_else(|| default_hotkey().key);
                shortcuts::HotkeyConfig {
                    key,
                    mode: shortcuts::HotkeyMode::Toggle,
                }
            });
            // A saved hotkey that cannot start (typically a missing macOS permission) falls
            // back to the default so dictation still works, but the user must be told.
            let mut hotkey_notice = None;
            if let Err(error) = hotkeys.configure(config) {
                let _ = logging::write(&data_dir.join("logs"), "error", &error);
                let _ = hotkeys.configure(default_hotkey());
                hotkey_notice = Some(format!(
                    "您儲存的快速鍵目前無法使用，已暫時改用預設快速鍵。{error}"
                ));
            }
            hotkeys.set_notice(hotkey_notice.clone());
            indicator::Indicator::prepare(app.handle())?;
            app.manage(AppState {
                db: Mutex::new(db),
                speech: Arc::new(speech),
                data_dir: data_dir.clone(),
                progress: Arc::new(Mutex::new(json!({"progress":0}))),
                hotkeys,
                indicator: indicator::Indicator::default(),
                recording: AtomicBool::new(false),
                interface: Mutex::new(interface::Interface::new(mode)),
            });
            logging::write(
                &data_dir.join("logs"),
                "info",
                "QuQu native desktop started",
            )?;
            setup_tray(app.handle())?;
            let state = app.state::<AppState>();
            state.indicator.track_external(app.handle());
            state.indicator.apply_mode(app.handle(), mode)?;
            if hotkey_notice.is_some() {
                // Surface the problem where the fix (permission buttons) lives.
                let _ = windows::open(app.handle(), "settings");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
            if window.label() == "settings"
                && matches!(
                    event,
                    tauri::WindowEvent::Destroyed | tauri::WindowEvent::Focused(false)
                )
            {
                if let Some(state) = window.app_handle().try_state::<AppState>() {
                    state.hotkeys.set_capture(false);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![desktop_command])
        .run(tauri::generate_context!())
        .expect("Unable to run QuQu desktop");
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    use tauri::{
        menu::{CheckMenuItem, Menu, MenuItem},
        tray::TrayIconBuilder,
    };
    let classic = CheckMenuItem::with_id(
        app,
        "classic",
        "經典介面",
        true,
        app.state::<AppState>().interface.lock().unwrap().mode == interface::Mode::Classic,
        None::<&str>,
    )?;
    let compact = CheckMenuItem::with_id(
        app,
        "compact",
        "極簡介面",
        true,
        app.state::<AppState>().interface.lock().unwrap().mode == interface::Mode::Compact,
        None::<&str>,
    )?;
    let show = MenuItem::with_id(app, "show", "開始/停止聽寫", true, None::<&str>)?;
    let cancel = MenuItem::with_id(app, "cancel", "取消聽寫", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "設定", true, None::<&str>)?;
    let history = MenuItem::with_id(app, "history", "歷史記錄", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "結束", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &classic, &compact, &show, &cancel, &settings, &history, &quit,
        ],
    )?;
    app.manage(menu.clone());
    let mut tray = TrayIconBuilder::with_id("ququ")
        .menu(&menu)
        .tooltip("蛐蛐")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "classic" | "compact" => {
                if let Err(error) = set_interface_mode(app, event.id.as_ref()) {
                    let mode = app.state::<AppState>().interface.lock().unwrap().mode;
                    sync_mode_menu(app, mode);
                    let state = app.state::<AppState>();
                    let _ = logging::write(&state.data_dir.join("logs"), "warn", &error);
                    if let Some(tray) = app.tray_by_id("ququ") {
                        let _ = tray.set_tooltip(Some(format!("蛐蛐：{error}")));
                    }
                }
            }
            "quit" => app.exit(0),
            "cancel" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit(
                        "hotkey-triggered",
                        json!({"action":"cancel","source":"tray"}),
                    );
                }
            }
            "settings" => {
                let _ = windows::open(app, "settings");
            }
            "history" => {
                let _ = windows::open(app, "history");
            }
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.emit(
                        "hotkey-triggered",
                        json!({"action":"toggle","source":"tray"}),
                    );
                }
            }
            _ => {}
        });
    let icon = tauri::image::Image::from_bytes(include_bytes!("../../assets/icon.png"))
        .ok()
        .or_else(|| app.default_window_icon().cloned());
    if let Some(icon) = icon {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

// Native getters may synchronously dispatch to the UI thread. Serialize the complete
// transition there so tray callbacks can never block that thread on an IPC-held lock.
async fn dispatch_interface_mode(app: &AppHandle, name: &str) -> Result<(), String> {
    let name = name.to_owned();
    let handle = app.clone();
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let _ = sender.send(set_interface_mode(&handle, &name));
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receiver.recv().map_err(|error| error.to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

fn set_interface_mode(app: &AppHandle, name: &str) -> Result<(), String> {
    let mode = interface::Mode::parse(name)?;
    let state = app.state::<AppState>();
    let mut current = state.interface.lock().map_err(|e| e.to_string())?;
    let selection = current.select(mode)?;
    if selection == interface::Selection::Reveal {
        let window = app
            .get_webview_window("main")
            .ok_or("Dictation window unavailable")?;
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    } else if selection == interface::Selection::Switch {
        let previous = current.mode;
        if let Err(error) = state.indicator.apply_mode(app, mode) {
            let _ = state.indicator.apply_mode(app, previous);
            return Err(error);
        }
        let persistence = state
            .database()
            .and_then(|db| db.set("interface_mode", &json!(mode.name())));
        if let Err(error) = persistence {
            let rollback = state.indicator.apply_mode(app, previous);
            return Err(match rollback {
                Ok(()) => error,
                Err(rollback) => format!("{error}; window rollback failed: {rollback}"),
            });
        }
        current.mode = mode;
    }
    drop(current);
    sync_mode_menu(app, mode);
    app.emit("interface-mode-changed", json!({"mode":mode.name()}))
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn sync_mode_menu(app: &AppHandle, mode: interface::Mode) {
    let menu = app.state::<tauri::menu::Menu<tauri::Wry>>();
    for (id, checked) in [
        ("classic", mode == interface::Mode::Classic),
        ("compact", mode == interface::Mode::Compact),
    ] {
        if let Some(item) = menu.get(id) {
            if let Some(item) = item.as_check_menuitem() {
                let _ = item.set_checked(checked);
            }
        }
    }
}

fn sync_recording_tray(app: &AppHandle, recording: bool) {
    if let Some(tray) = app.tray_by_id("ququ") {
        let tooltip = if recording {
            "蛐蛐 - 正在录音..."
        } else {
            "蛐蛐"
        };
        let _ = tray.set_tooltip(Some(tooltip));
    }
}
