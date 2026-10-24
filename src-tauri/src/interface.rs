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
}
