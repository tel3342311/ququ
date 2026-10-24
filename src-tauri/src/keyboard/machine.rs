#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Action {
    Toggle,
    Start,
    Stop,
    Cancel,
}
#[derive(Default)]
pub struct Machine {
    pub hold: bool,
    down: bool,
    chorded: bool,
    active: bool,
}
impl Machine {
    pub fn key(
        &mut self,
        selected: bool,
        pressed: bool,
        injected: bool,
        other_down: bool,
    ) -> Option<Action> {
        if injected {
            return None;
        }
        if !selected {
            if pressed && self.down {
                self.chorded = true;
                if self.active {
                    self.active = false;
                    return Some(Action::Cancel);
                }
            }
            return None;
        }
        if pressed {
            if self.down {
                return None;
            }
            self.down = true;
            self.chorded = other_down;
            if self.hold && !self.chorded {
                self.active = true;
                return Some(Action::Start);
            }
            return None;
        }
        if !self.down {
            return None;
        }
        self.down = false;
        if self.active {
            self.active = false;
            return Some(Action::Stop);
        }
        if !self.hold && !self.chorded {
            return Some(Action::Toggle);
        }
        None
    }
    pub fn suspend(&mut self) -> Option<Action> {
        self.chorded = true;
        if self.active {
            self.active = false;
            Some(Action::Cancel)
        } else {
            None
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn toggle_only_after_clean_release() {
        let mut m = Machine::default();
        assert_eq!(m.key(true, true, false, false), None);
        assert_eq!(m.key(true, true, false, false), None);
        assert_eq!(m.key(true, false, false, false), Some(Action::Toggle));
    }
    #[test]
    fn modifier_chord_never_toggles() {
        let mut m = Machine::default();
        m.key(true, true, false, false);
        m.key(false, true, false, false);
        assert_eq!(m.key(true, false, false, false), None);
    }
    #[test]
    fn hold_cancels_chord_without_stop_or_repeat() {
        let mut m = Machine {
            hold: true,
            ..Default::default()
        };
        assert_eq!(m.key(true, true, false, false), Some(Action::Start));
        assert_eq!(m.key(true, true, false, false), None);
        assert_eq!(m.key(false, true, false, false), Some(Action::Cancel));
        assert_eq!(m.key(true, false, false, false), None);
    }
    #[test]
    fn injected_keys_do_not_trigger_or_cancel() {
        let mut m = Machine::default();
        m.key(true, true, true, false);
        assert_eq!(m.key(true, false, true, false), None);
        m.key(true, true, false, false);
        m.key(false, true, true, false);
        assert_eq!(m.key(true, false, false, false), Some(Action::Toggle));
    }
    #[test]
    fn preexisting_chord_and_capture_are_inert() {
        let mut m = Machine {
            hold: true,
            ..Default::default()
        };
        assert_eq!(m.key(true, true, false, true), None);
        assert_eq!(m.key(true, false, false, false), None);
        assert_eq!(m.key(true, true, false, false), Some(Action::Start));
        assert_eq!(m.suspend(), Some(Action::Cancel));
        assert_eq!(m.key(true, false, false, false), None);
    }
    #[test]
    fn clean_hold_stops_once() {
        let mut m = Machine {
            hold: true,
            ..Default::default()
        };
        assert_eq!(m.key(true, true, false, false), Some(Action::Start));
        assert_eq!(m.key(true, false, false, false), Some(Action::Stop));
        assert_eq!(m.key(true, false, false, false), None);
    }
}
