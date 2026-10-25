mod geometry;
use geometry::{place, WorkArea};
use std::sync::{
    atomic::{AtomicIsize, AtomicU64, Ordering},
    Arc,
};
use tauri::{AppHandle, Manager, PhysicalPosition};

pub const FADE_MS: u64 = 180;

#[derive(Default)]
pub struct Indicator {
    generation: Arc<AtomicU64>,
    target: AtomicIsize,
    last_external: Arc<AtomicIsize>,
    own: Arc<AtomicIsize>,
    classic_position: std::sync::Mutex<Option<PhysicalPosition<i32>>>,
    paste_epoch: Arc<AtomicU64>,
}

#[cfg(windows)]
fn foreground() -> isize {
    // Only the handle is retained. Typed text and other applications' contents are not read.
    unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as isize }
}
#[cfg(target_os = "macos")]
fn foreground() -> isize {
    // The frontmost application's pid identifies the paste target. No window contents are read.
    objc2_app_kit::NSWorkspace::sharedWorkspace()
        .frontmostApplication()
        .map_or(0, |app| app.processIdentifier() as isize)
}
#[cfg(not(any(windows, target_os = "macos")))]
fn foreground() -> isize {
    0
}

/// Bring the application that owned focus when dictation began back to the front.
#[cfg(target_os = "macos")]
#[allow(deprecated)] // activateWithOptions is the only API that works before macOS 14.
fn activate(pid: isize) -> bool {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
    NSRunningApplication::runningApplicationWithProcessIdentifier(pid as i32).is_some_and(|app| {
        app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps)
    })
}

/// Whether text may be pasted: the dictation was not cancelled, focus is not on QuQu itself,
/// and focus is still on the application that was captured when dictation began.
fn paste_allowed(epoch_current: bool, external: bool, target: isize, current: isize) -> bool {
    epoch_current && external && (target == 0 || target == current)
}

fn position(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Dictation window unavailable")?;
    // Sample once at recording start. Later mouse movement must not move the overlay.
    let mouse = window.cursor_position().map_err(|e| e.to_string())?;
    let anchor = (mouse.x.round() as i32, mouse.y.round() as i32);
    let monitor = window
        .monitor_from_point(f64::from(anchor.0), f64::from(anchor.1))
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("No monitor available")?;
    let work = monitor.work_area();
    let (x, y) = place(
        anchor,
        WorkArea {
            left: work.position.x,
            top: work.position.y,
            width: work.size.width,
            height: work.size.height,
        },
        monitor.scale_factor(),
    );
    let previous = window.outer_position().map_err(|e| e.to_string())?;
    if (i64::from(previous.x) - i64::from(x)).abs() > 3
        || (i64::from(previous.y) - i64::from(y)).abs() > 3
    {
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Tao retains hidden caption styles on Windows. They impose a minimum track
// width even on an undecorated window, so use a true borderless overlay style.
#[cfg(windows)]
fn size_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as _;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    unsafe {
        let style = GetWindowLongW(hwnd, GWL_STYLE) as u32;
        SetWindowLongW(
            hwnd,
            GWL_STYLE,
            (style & !(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX))
                as i32,
        );
        if SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            (geometry::WIDTH * scale).round() as i32,
            (geometry::HEIGHT * scale).round() as i32,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        ) == 0
        {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
#[cfg(not(windows))]
fn size_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(geometry::WIDTH, geometry::HEIGHT))
        .map_err(|e| e.to_string())
}

impl Indicator {
    pub fn prepare(app: &AppHandle) -> Result<(), String> {
        app.get_webview_window("main")
            .ok_or("Dictation window unavailable")?;
        Ok(())
    }
    pub fn track_external(&self, app: &AppHandle) {
        #[cfg(windows)]
        if let Some(window) = app.get_webview_window("main") {
            if let Ok(hwnd) = window.hwnd() {
                self.own.store(hwnd.0 as isize, Ordering::Release);
            }
        }
        #[cfg(target_os = "macos")]
        self.own
            .store(std::process::id() as isize, Ordering::Release);
        let last = self.last_external.clone();
        #[cfg(not(windows))]
        let own = self.own.clone();
        tauri::async_runtime::spawn_blocking(move || loop {
            let current = foreground();
            #[cfg(windows)]
            let external = unsafe {
                let mut pid = 0;
                windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
                    current as _,
                    &mut pid,
                );
                pid != std::process::id()
            };
            #[cfg(not(windows))]
            let external = current != own.load(Ordering::Acquire);
            if current != 0 && external {
                last.store(current, Ordering::Release);
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        });
    }
    pub fn capture_target(&self) {
        self.paste_epoch.fetch_add(1, Ordering::AcqRel);
        let current = foreground();
        #[cfg(windows)]
        let own_foreground = unsafe {
            let mut pid = 0;
            windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
                current as _,
                &mut pid,
            );
            pid == std::process::id()
        };
        #[cfg(not(windows))]
        let own_foreground = current == self.own.load(Ordering::Acquire);
        self.target.store(
            if own_foreground {
                self.last_external.load(Ordering::Acquire)
            } else {
                current
            },
            Ordering::Release,
        );
    }
    pub fn apply_mode(&self, app: &AppHandle, mode: crate::interface::Mode) -> Result<(), String> {
        self.generation.fetch_add(1, Ordering::AcqRel);
        let window = app
            .get_webview_window("main")
            .ok_or("Dictation window unavailable")?;
        let classic = mode == crate::interface::Mode::Classic;
        window
            .set_min_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|e| e.to_string())?;
        window
            .set_max_size(None::<tauri::LogicalSize<f64>>)
            .map_err(|e| e.to_string())?;
        window.set_focusable(classic).map_err(|e| e.to_string())?;
        window
            .set_ignore_cursor_events(!classic)
            .map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window
            .set_skip_taskbar(!classic)
            .map_err(|e| e.to_string())?;
        if classic {
            if let Some(position) = *self.classic_position.lock().map_err(|e| e.to_string())? {
                window.set_position(position).map_err(|e| e.to_string())?;
            } else {
                let _ = window.center();
            }
            window
                .set_size(tauri::LogicalSize::new(400.0, 500.0))
                .map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        } else {
            if let Ok(position) = window.outer_position() {
                *self.classic_position.lock().map_err(|e| e.to_string())? = Some(position);
            }
            size_window(&window)?;
            window.hide().map_err(|e| e.to_string())?;
        }
        Ok(())
    }
    pub fn set_recording(&self, app: &AppHandle, recording: bool) -> Result<(), String> {
        if app
            .state::<crate::AppState>()
            .interface
            .lock()
            .map_err(|e| e.to_string())?
            .mode
            == crate::interface::Mode::Classic
        {
            if recording {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                }
            }
            return Ok(());
        }
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        let clock = self.generation.clone();
        let handle = app.clone();
        if recording {
            position(app)?;
            let show_app = app.clone();
            let show_clock = clock.clone();
            app.run_on_main_thread(move || {
                if show_clock.load(Ordering::Acquire) == generation {
                    if let Some(window) = show_app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = size_window(&window);
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        } else {
            tauri::async_runtime::spawn_blocking(move || {
                std::thread::sleep(std::time::Duration::from_millis(FADE_MS));
                let hide_app = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    if clock.load(Ordering::Acquire) == generation {
                        if let Some(window) = hide_app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                });
            });
        }
        Ok(())
    }
    pub fn prepare_paste(&self) {
        #[cfg(target_os = "macos")]
        {
            // A Classic-mode click makes QuQu the active application, so Cmd+V would be
            // delivered to QuQu. Give focus back to the captured application first.
            let target = self.target.load(Ordering::Acquire);
            if target != 0 && foreground() == self.own.load(Ordering::Acquire) && activate(target) {
                for _ in 0..30 {
                    if foreground() == target {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
            }
        }
        #[cfg(windows)]
        unsafe {
            let current = foreground();
            let mut pid = 0;
            windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
                current as _,
                &mut pid,
            );
            let target = self.target.load(Ordering::Acquire);
            if pid == std::process::id() && target != 0 {
                windows_sys::Win32::UI::WindowsAndMessaging::SetForegroundWindow(target as _);
            }
        }
    }
    pub fn target_window(&self) -> isize {
        self.target.load(Ordering::Acquire)
    }
    pub fn invalidate_paste(&self) {
        self.paste_epoch.fetch_add(1, Ordering::AcqRel);
    }
    pub fn paste_guard(&self) -> impl Fn() -> bool + Send + 'static {
        let target = self.target.load(Ordering::Acquire);
        let clock = self.paste_epoch.clone();
        let epoch = clock.load(Ordering::Acquire);
        #[cfg(any(windows, target_os = "macos"))]
        let own = self.own.load(Ordering::Acquire);
        move || {
            let current = foreground();
            #[cfg(windows)]
            let external = unsafe {
                let mut pid = 0;
                windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId(
                    current as _,
                    &mut pid,
                );
                pid != std::process::id() && current != own
            };
            #[cfg(target_os = "macos")]
            let external = current != own;
            #[cfg(not(any(windows, target_os = "macos")))]
            let external = true;
            paste_allowed(
                clock.load(Ordering::Acquire) == epoch,
                external,
                target,
                current,
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::paste_allowed;

    #[test]
    fn paste_requires_external_focus_on_the_captured_application() {
        assert!(paste_allowed(true, true, 42, 42));
        assert!(
            paste_allowed(true, true, 0, 7),
            "no captured target accepts any external app"
        );
        assert!(
            !paste_allowed(true, false, 42, 42),
            "never paste into QuQu itself"
        );
        assert!(
            !paste_allowed(true, true, 42, 43),
            "focus moved to another application"
        );
        assert!(
            !paste_allowed(false, true, 42, 42),
            "cancelled dictation is invalidated"
        );
    }
}
