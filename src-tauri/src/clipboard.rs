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
pub fn paste(text: &str, guard: impl Fn() -> bool) -> Result<(), String> {
    copy(text)?;
    // Allow the target window a brief moment to settle focus after overlay/indicator hides.
    sleep(Duration::from_millis(30));

    if !guard() {
        return Err("Focus changed or dictation cancelled; text copied instead of pasted".into());
    }

    let mut keyboard = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
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
        // On Windows, use Key::V (VK_V) with explicit key press/release spacing
        // so that Chromium, Electron (e.g. Herd), and Win32 event loops register the accelerator.
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

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
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
