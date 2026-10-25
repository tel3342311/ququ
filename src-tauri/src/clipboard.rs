use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use std::thread::sleep;
use std::time::Duration;

#[cfg(target_os = "macos")]
const MACOS_PASTE_KEY: Key = Key::Other(9); // kVK_ANSI_V (0x09)

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
    send_paste_keys(&mut keyboard)
}

fn send_paste_keys(keyboard: &mut impl Keyboard) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // On macOS: use Cmd + V with physical kVK_ANSI_V (Key::Other(9)).
        // Key::Unicode('v') queries Text Services Manager (TSMGetInputSourceProperty),
        // which asserts the main dispatch queue and crashes on background threads.
        keyboard
            .key(Key::Meta, Direction::Press)
            .map_err(|e| e.to_string())?;
        sleep(Duration::from_millis(15));
        let result = keyboard
            .key(MACOS_PASTE_KEY, Direction::Click)
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

#[cfg(test)]
mod tests {
    use super::*;
    use enigo::{InputError, InputResult};

    #[derive(Default)]
    struct RecordingKeyboard {
        events: Vec<(Key, Direction)>,
        fail_on_click: bool,
    }

    impl Keyboard for RecordingKeyboard {
        fn fast_text(&mut self, _text: &str) -> InputResult<Option<()>> {
            Ok(Some(()))
        }

        fn key(&mut self, key: Key, direction: Direction) -> InputResult<()> {
            self.events.push((key, direction));
            if self.fail_on_click && direction == Direction::Click {
                return Err(InputError::Simulate("simulated click error"));
            }
            Ok(())
        }

        fn raw(&mut self, keycode: u16, direction: Direction) -> InputResult<()> {
            self.events
                .push((Key::Other(u32::from(keycode)), direction));
            Ok(())
        }
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_paste_uses_physical_v_keycode_without_unicode_lookup() {
        let mut keyboard = RecordingKeyboard::default();
        send_paste_keys(&mut keyboard).expect("paste key sequence should succeed");

        assert_eq!(
            keyboard.events,
            vec![
                (Key::Meta, Direction::Press),
                (Key::Other(9), Direction::Click),
                (Key::Meta, Direction::Release),
            ]
        );
        assert!(
            keyboard
                .events
                .iter()
                .all(|(key, _)| !matches!(key, Key::Unicode(_))),
            "macOS paste must not use layout-dependent Key::Unicode off the main thread"
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_paste_releases_command_when_v_click_fails() {
        let mut keyboard = RecordingKeyboard {
            events: Vec::new(),
            fail_on_click: true,
        };
        let err = send_paste_keys(&mut keyboard).expect_err("click failure should propagate");
        assert!(err.contains("simulated click error"));
        assert_eq!(
            keyboard.events,
            vec![
                (Key::Meta, Direction::Press),
                (Key::Other(9), Direction::Click),
                (Key::Meta, Direction::Release),
            ]
        );
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn non_macos_paste_uses_shift_insert_and_releases_shift_on_failure() {
        let mut keyboard = RecordingKeyboard::default();
        send_paste_keys(&mut keyboard).expect("paste key sequence should succeed");
        assert_eq!(
            keyboard.events,
            vec![
                (Key::Shift, Direction::Press),
                (Key::Insert, Direction::Click),
                (Key::Shift, Direction::Release),
            ]
        );

        let mut failing = RecordingKeyboard {
            events: Vec::new(),
            fail_on_click: true,
        };
        let err = send_paste_keys(&mut failing).expect_err("click failure should propagate");
        assert!(err.contains("simulated click error"));
        assert_eq!(
            failing.events,
            vec![
                (Key::Shift, Direction::Press),
                (Key::Insert, Direction::Click),
                (Key::Shift, Direction::Release),
            ]
        );
    }
}
