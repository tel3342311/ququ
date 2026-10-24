use enigo::{Direction, Enigo, Key, Keyboard, Settings};

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
    let mut keyboard = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    if !guard() {
        return Err("Focus changed or dictation cancelled; text copied instead of pasted".into());
    }
    keyboard
        .key(modifier, Direction::Press)
        .map_err(|e| e.to_string())?;
    let result = keyboard
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| e.to_string());
    let release = keyboard
        .key(modifier, Direction::Release)
        .map_err(|e| e.to_string());
    result.and(release)
}
