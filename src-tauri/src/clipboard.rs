use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread::sleep;
use std::time::Duration;

pub fn copy(text: &str) -> Result<(), String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .set_text(text)
        .map_err(|e| e.to_string())
}

pub fn read() -> Result<String, String> {
    arboard::Clipboard::new()
        .map_err(|e| e.to_string())?
        .get_text()
        .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn is_terminal_window(hwnd: isize) -> bool {
    let target_hwnd = if hwnd != 0 {
        hwnd
    } else {
        unsafe { windows_sys::Win32::UI::WindowsAndMessaging::GetForegroundWindow() as isize }
    };
    if target_hwnd == 0 {
        return false;
    }
    use windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW;
    let mut class_name = [0u16; 256];
    let len = unsafe { GetClassNameW(target_hwnd as _, class_name.as_mut_ptr(), 256) };
    if len > 0 {
        let name = String::from_utf16_lossy(&class_name[..len as usize]).to_lowercase();
        // Common terminal window class names:
        // - org.wezfurlong.wezterm (WezTerm)
        // - cascadia_hosting_window_class (Windows Terminal)
        // - alacritty (Alacritty)
        // - consolewindowclass (cmd.exe / PowerShell / conhost)
        // - mintty (Git Bash / Cygwin / MSYS2)
        // - putty (PuTTY)
        // - vterm / xterm / kitty
        if name.contains("wezterm")
            || name.contains("cascadia")
            || name.contains("alacritty")
            || name.contains("consolewindowclass")
            || name.contains("mintty")
            || name.contains("putty")
            || name.contains("terminal")
            || name.contains("kitty")
            || name.contains("xterm")
        {
            return true;
        }
    }
    false
}

#[cfg(not(windows))]
fn is_terminal_window(_hwnd: isize) -> bool {
    false
}

pub fn paste(text: &str, guard: impl Fn() -> bool, target: isize) -> Result<(), String> {
    copy(text)?;
    // Allow the target window a brief moment to settle focus after overlay/indicator hides.
    sleep(Duration::from_millis(30));

    if !guard() {
        return Err("Focus changed or dictation cancelled; text copied instead of pasted".into());
    }

    let mut keyboard = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        let _ = target;
        keyboard
            .key(Key::Meta, Direction::Press)
            .map_err(|e| e.to_string())?;
        sleep(Duration::from_millis(15));
        let result = keyboard
            .key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| e.to_string());
        sleep(Duration::from_millis(15));
        let release = keyboard
            .key(Key::Meta, Direction::Release)
            .map_err(|e| e.to_string());
        result.and(release)
    }

    #[cfg(target_os = "windows")]
    {
        let is_term = is_terminal_window(target);
        if is_term {
            // In terminals (WezTerm, Windows Terminal, Alacritty), Ctrl+V sends ^V (ASCII 0x16 / literal next).
            // Terminals use Ctrl+Shift+V as the universal paste shortcut from Clipboard.
            keyboard
                .key(Key::Control, Direction::Press)
                .map_err(|e| e.to_string())?;
            keyboard
                .key(Key::Shift, Direction::Press)
                .map_err(|e| e.to_string())?;
            sleep(Duration::from_millis(20));
            let result = keyboard
                .key(Key::V, Direction::Click)
                .map_err(|e| e.to_string());
            sleep(Duration::from_millis(20));
            let release_shift = keyboard
                .key(Key::Shift, Direction::Release)
                .map_err(|e| e.to_string());
            let release_ctrl = keyboard
                .key(Key::Control, Direction::Release)
                .map_err(|e| e.to_string());
            result.and(release_shift).and(release_ctrl)
        } else {
            // Standard Windows applications use Ctrl+V.
            keyboard
                .key(Key::Control, Direction::Press)
                .map_err(|e| e.to_string())?;
            sleep(Duration::from_millis(20));
            let result = keyboard
                .key(Key::V, Direction::Click)
                .map_err(|e| e.to_string());
            sleep(Duration::from_millis(20));
            let release = keyboard
                .key(Key::Control, Direction::Release)
                .map_err(|e| e.to_string());
            result.and(release)
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let is_term = is_terminal_window(target);
        if is_term {
            keyboard
                .key(Key::Control, Direction::Press)
                .map_err(|e| e.to_string())?;
            keyboard
                .key(Key::Shift, Direction::Press)
                .map_err(|e| e.to_string())?;
            sleep(Duration::from_millis(15));
            let result = keyboard
                .key(Key::Unicode('v'), Direction::Click)
                .map_err(|e| e.to_string());
            sleep(Duration::from_millis(15));
            let release_shift = keyboard
                .key(Key::Shift, Direction::Release)
                .map_err(|e| e.to_string());
            let release_ctrl = keyboard
                .key(Key::Control, Direction::Release)
                .map_err(|e| e.to_string());
            result.and(release_shift).and(release_ctrl)
        } else {
            keyboard
                .key(Key::Control, Direction::Press)
                .map_err(|e| e.to_string())?;
            sleep(Duration::from_millis(15));
            let result = keyboard
                .key(Key::Unicode('v'), Direction::Click)
                .map_err(|e| e.to_string());
            sleep(Duration::from_millis(15));
            let release = keyboard
                .key(Key::Control, Direction::Release)
                .map_err(|e| e.to_string());
            result.and(release)
        }
    }
}
