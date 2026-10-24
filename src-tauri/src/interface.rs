use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Classic,
    Compact,
}
impl Mode {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "classic" => Ok(Self::Classic),
            "compact" => Ok(Self::Compact),
            _ => Err("Invalid interface mode".into()),
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Self::Classic => "classic",
            Self::Compact => "compact",
        }
    }
    pub fn migrate(stored: &Value, hotkey: &Value) -> Self {
        stored
            .as_str()
            .and_then(|s| Self::parse(s).ok())
            .unwrap_or(if hotkey.is_null() {
                Self::Classic
            } else {
                Self::Compact
            })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Selection {
    Reveal,
    Keep,
    Switch,
}
pub struct Interface {
    pub mode: Mode,
    pub phase: String,
}
impl Interface {
    pub fn new(mode: Mode) -> Self {
        Self {
            mode,
            phase: "idle".into(),
        }
    }
    pub fn allow_switch(&self) -> Result<(), String> {
        if self.phase == "idle" {
            Ok(())
        } else {
            Err("Wait for dictation to finish before changing interface mode".into())
        }
    }
    pub fn select(&self, target: Mode) -> Result<Selection, String> {
        if target == Mode::Classic && self.mode == Mode::Classic {
            return Ok(Selection::Reveal);
        }
        self.allow_switch()?;
        Ok(if target == self.mode {
            Selection::Keep
        } else {
            Selection::Switch
        })
    }
    pub fn set_phase(&mut self, phase: &str) -> Result<(), String> {
        if !["idle", "starting", "recording", "processing", "optimizing"].contains(&phase) {
            return Err("Invalid dictation phase".into());
        }
        self.phase = phase.into();
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_preserves_native_installations() {
        assert_eq!(Mode::migrate(&Value::Null, &Value::Null), Mode::Classic);
        assert_eq!(
            Mode::migrate(&Value::Null, &serde_json::json!({"key":"F2"})),
            Mode::Compact
        );
        assert_eq!(
            Mode::migrate(&serde_json::json!("classic"), &serde_json::json!({})),
            Mode::Classic
        );
    }
    #[test]
    fn every_busy_phase_rejects_switch() {
        let mut state = Interface::new(Mode::Classic);
        for phase in ["starting", "recording", "processing", "optimizing"] {
            state.set_phase(phase).unwrap();
            assert!(state.allow_switch().is_err());
            assert_eq!(state.mode, Mode::Classic);
        }
        state.set_phase("idle").unwrap();
        assert!(state.allow_switch().is_ok());
        assert!(state.set_phase("unknown").is_err());
    }
    #[test]
    fn reselecting_classic_reveals_window_in_every_phase() {
        let mut state = Interface::new(Mode::Classic);
        for phase in ["idle", "starting", "recording", "processing", "optimizing"] {
            state.set_phase(phase).unwrap();
            assert_eq!(state.select(Mode::Classic), Ok(Selection::Reveal));
        }
        state.set_phase("recording").unwrap();
        assert!(state.select(Mode::Compact).is_err());
        state.set_phase("idle").unwrap();
        assert_eq!(state.select(Mode::Compact), Ok(Selection::Switch));
        let compact = Interface::new(Mode::Compact);
        assert_eq!(compact.select(Mode::Compact), Ok(Selection::Keep));
        assert_eq!(compact.select(Mode::Classic), Ok(Selection::Switch));
    }
}
