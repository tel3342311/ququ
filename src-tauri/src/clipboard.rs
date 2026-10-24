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

pub fn paste(text: &str, guard: impl Fn() -> bool, _target: isize) -> Result<(), String> {
    copy(text)?;
    // Allow the target window a brief moment to settle focus after overlay/indicator hides.
    sleep(Duration::from_millis(30));

    if !guard() {
        return Err("Focus changed or dictation cancelled; text copied instead of pasted".into());
    }

    let mut keyboard = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    #[cfg(target_os = "macos")]
    {
        // On macOS: use Cmd + V (Key::Meta + 'v')
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
        // On Windows: use Shift + Insert
        // This is the universal Windows CUA paste standard supported by Win32 controls,
        // browsers, editors, and terminal emulators (WezTerm, Windows Terminal, ConEmu, Mintty).
        // It avoids the terminal ^V control character issue completely.
        keyboard
            .key(Key::Shift, Direction::Press)
            .map_err(|e| e.to_string())?;
        sleep(Duration::from_millis(20));
        let result = keyboard
            .key(Key::Insert, Direction::Click)
            .map_err(|e| e.to_string());
        sleep(Duration::from_millis(20));
        let release = keyboard
            .key(Key::Shift, Direction::Release)
            .map_err(|e| e.to_string());
        result.and(release)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // On Linux: use Shift + Insert
        keyboard
            .key(Key::Shift, Direction::Press)
            .map_err(|e| e.to_string())?;
        sleep(Duration::from_millis(15));
        let result = keyboard
            .key(Key::Insert, Direction::Click)
            .map_err(|e| e.to_string());
        sleep(Duration::from_millis(15));
        let release = keyboard
            .key(Key::Shift, Direction::Release)
            .map_err(|e| e.to_string());
        result.and(release)
    }
}
