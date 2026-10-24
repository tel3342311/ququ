//! Dedicated CGEventTap thread for macOS. Hook callbacks only enqueue physical input;
//! they never block on application locks or consume a user's keystrokes.

use std::{
    ffi::c_void,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread::{self, JoinHandle},
};

pub const NX_DEVICELCTLKEYMASK: u64 = 0x00000001;
pub const NX_DEVICELSHIFTKEYMASK: u64 = 0x00000002;
pub const NX_DEVICERSHIFTKEYMASK: u64 = 0x00000004;
pub const NX_DEVICELCMDKEYMASK: u64 = 0x00000008;
pub const NX_DEVICERCMDKEYMASK: u64 = 0x00000010;
pub const NX_DEVICELALTKEYMASK: u64 = 0x00000020;
pub const NX_DEVICERALTKEYMASK: u64 = 0x00000040;
pub const NX_DEVICERCTLKEYMASK: u64 = 0x00002000;

pub const KEY_CONTROL_LEFT: u32 = 0x3B;
pub const KEY_CONTROL_RIGHT: u32 = 0x3E;
pub const KEY_SHIFT_LEFT: u32 = 0x38;
pub const KEY_SHIFT_RIGHT: u32 = 0x3C;
pub const KEY_ALT_LEFT: u32 = 0x3A;
pub const KEY_ALT_RIGHT: u32 = 0x3D;
pub const KEY_COMMAND_LEFT: u32 = 0x37;
pub const KEY_COMMAND_RIGHT: u32 = 0x36;

pub const PERMISSION_ERROR_MESSAGE: &str =
    "macOS Input Monitoring or Accessibility permission is required for single modifier hotkeys. Please grant QuQu permission in System Settings > Privacy & Security > Accessibility.";

pub fn modifier_mask(key: usize) -> Option<u64> {
    match key as u32 {
        KEY_CONTROL_LEFT => Some(NX_DEVICELCTLKEYMASK),
        KEY_CONTROL_RIGHT => Some(NX_DEVICERCTLKEYMASK),
        KEY_SHIFT_LEFT => Some(NX_DEVICELSHIFTKEYMASK),
        KEY_SHIFT_RIGHT => Some(NX_DEVICERSHIFTKEYMASK),
        KEY_ALT_LEFT => Some(NX_DEVICELALTKEYMASK),
        KEY_ALT_RIGHT => Some(NX_DEVICERALTKEYMASK),
        KEY_COMMAND_LEFT => Some(NX_DEVICELCMDKEYMASK),
        KEY_COMMAND_RIGHT => Some(NX_DEVICERCMDKEYMASK),
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Input {
    pub key: u32,
    pub pressed: bool,
    pub captured: bool,
}

#[derive(Default)]
pub struct Provenance {
    target: AtomicU32,
    activations: AtomicU32,
    capture: AtomicBool,
}

impl Provenance {
    pub fn set_capture(&self, capture: bool) {
        self.capture.store(capture, Ordering::SeqCst);
    }
    pub fn configure(&self, vk: u32, modifiers: u32) -> u32 {
        self.target.store(vk | (modifiers << 8), Ordering::SeqCst);
        self.count()
    }
    pub fn count(&self) -> u32 {
        self.activations.load(Ordering::SeqCst)
    }
}

type CFMachPortRef = *mut c_void;
type CFRunLoopRef = *mut c_void;
type CFRunLoopSourceRef = *mut c_void;
type CFRunLoopMode = *const c_void;
type CFAllocatorRef = *const c_void;
type CGEventRef = *mut c_void;
type CGEventTapProxy = *mut c_void;
type CGEventType = u32;

type CGEventTapCallBack = unsafe extern "C" fn(
    proxy: CGEventTapProxy,
    etype: CGEventType,
    event: CGEventRef,
    refcon: *mut c_void,
) -> CGEventRef;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventTapCreate(
        tap: u32,
        place: u32,
        options: u32,
        events_of_interest: u64,
        callback: Option<CGEventTapCallBack>,
        refcon: *mut c_void,
    ) -> CFMachPortRef;
    fn CGEventTapEnable(tap: CFMachPortRef, enable: bool);
    fn CGEventGetIntegerValueField(event: CGEventRef, field: u32) -> i64;
    fn CGEventGetFlags(event: CGEventRef) -> u64;
    fn CGEventSourceKeyState(state_id: i32, key: u16) -> bool;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFRunLoopCommonModes: CFRunLoopMode;
    static kCFBooleanTrue: *const c_void;
    static kCFTypeDictionaryKeyCallBacks: c_void;
    static kCFTypeDictionaryValueCallBacks: c_void;
    fn CFMachPortCreateRunLoopSource(
        allocator: CFAllocatorRef,
        port: CFMachPortRef,
        order: isize,
    ) -> CFRunLoopSourceRef;
    fn CFMachPortInvalidate(port: CFMachPortRef);
    fn CFRunLoopGetCurrent() -> CFRunLoopRef;
    fn CFRunLoopAddSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
    fn CFRunLoopRemoveSource(rl: CFRunLoopRef, source: CFRunLoopSourceRef, mode: CFRunLoopMode);
    fn CFRunLoopRun();
    fn CFRunLoopStop(rl: CFRunLoopRef);
    fn CFRunLoopWakeUp(rl: CFRunLoopRef);
    fn CFRelease(cf: *const c_void);
    fn CFDictionaryCreate(
        allocator: CFAllocatorRef,
        keys: *const *const c_void,
        values: *const *const c_void,
        num_values: isize,
        key_callbacks: *const c_void,
        value_callbacks: *const c_void,
    ) -> *const c_void;
}

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    fn AXIsProcessTrusted() -> bool;
    fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    static kAXTrustedCheckOptionPrompt: *const c_void;
}

pub fn is_process_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

pub fn prompt_accessibility() {
    unsafe {
        let keys = [kAXTrustedCheckOptionPrompt];
        let values = [kCFBooleanTrue];
        let dict = CFDictionaryCreate(
            std::ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            1,
            &kCFTypeDictionaryKeyCallBacks as *const _ as _,
            &kCFTypeDictionaryValueCallBacks as *const _ as _,
        );
        if !dict.is_null() {
            AXIsProcessTrustedWithOptions(dict);
            CFRelease(dict);
        }
    }
}

pub fn is_key_down(key: u16) -> bool {
    unsafe { CGEventSourceKeyState(1, key) }
}

struct Context {
    output: Sender<Input>,
    provenance: Arc<Provenance>,
    down: [bool; 256],
    tap: CFMachPortRef,
}

const NX_KEYDOWN: u32 = 10;
const NX_KEYUP: u32 = 11;
const NX_FLAGSCHANGED: u32 = 12;

const K_CG_KEYBOARD_EVENT_AUTOREPEAT: u32 = 8;
const K_CG_KEYBOARD_EVENT_KEYCODE: u32 = 9;

const K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT: u32 = 0xFFFFFFFE;
const K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT: u32 = 0xFFFFFFFF;

unsafe extern "C" fn callback(
    _proxy: CGEventTapProxy,
    etype: CGEventType,
    event: CGEventRef,
    refcon: *mut c_void,
) -> CGEventRef {
    if event.is_null() || refcon.is_null() {
        return event;
    }
    if etype == K_CG_EVENT_TAP_DISABLED_BY_TIMEOUT || etype == K_CG_EVENT_TAP_DISABLED_BY_USER_INPUT
    {
        let context = unsafe { &mut *(refcon as *mut Context) };
        if !context.tap.is_null() {
            CGEventTapEnable(context.tap, true);
        }
        return event;
    }

    let _ = std::panic::catch_unwind(|| {
        let context = unsafe { &mut *(refcon as *mut Context) };
        if etype == NX_KEYDOWN || etype == NX_KEYUP {
            let keycode = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as usize;
            if keycode >= 256 {
                return;
            }
            let pressed = etype == NX_KEYDOWN;
            let autorepeat =
                pressed && CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_AUTOREPEAT) != 0;
            if autorepeat {
                return;
            }
            let repeat = pressed && context.down[keycode];
            context.down[keycode] = pressed;
            if repeat {
                return;
            }
            update_provenance(context, keycode as u32, pressed);
            let _ = context.output.send(Input {
                key: keycode as u32,
                pressed,
                captured: context.provenance.capture.load(Ordering::SeqCst),
            });
        } else if etype == NX_FLAGSCHANGED {
            let keycode = CGEventGetIntegerValueField(event, K_CG_KEYBOARD_EVENT_KEYCODE) as usize;
            if keycode >= 256 {
                return;
            }
            let flags = CGEventGetFlags(event);
            let Some(mask) = modifier_mask(keycode) else {
                return;
            };
            let pressed = (flags & mask) != 0;
            let repeat = pressed && context.down[keycode];
            context.down[keycode] = pressed;
            if repeat {
                return;
            }
            update_provenance(context, keycode as u32, pressed);
            let _ = context.output.send(Input {
                key: keycode as u32,
                pressed,
                captured: context.provenance.capture.load(Ordering::SeqCst),
            });
        }
    });

    event
}

fn update_provenance(context: &Context, keycode: u32, pressed: bool) {
    if pressed {
        let down = &context.down;
        let mods = u32::from(down[KEY_SHIFT_LEFT as usize] || down[KEY_SHIFT_RIGHT as usize])
            | (u32::from(down[KEY_CONTROL_LEFT as usize] || down[KEY_CONTROL_RIGHT as usize]) << 1)
            | (u32::from(down[KEY_ALT_LEFT as usize] || down[KEY_ALT_RIGHT as usize]) << 2)
            | (u32::from(down[KEY_COMMAND_LEFT as usize] || down[KEY_COMMAND_RIGHT as usize]) << 3);
        if context.provenance.target.load(Ordering::SeqCst) == keycode | (mods << 8) {
            context
                .provenance
                .activations
                .fetch_add(1, Ordering::SeqCst);
        }
    }
}

pub struct Hook {
    run_loop: usize,
    thread: Option<JoinHandle<()>>,
    provenance: Arc<Provenance>,
}

unsafe impl Send for Hook {}
unsafe impl Sync for Hook {}

impl Hook {
    pub fn start() -> Result<(Self, Receiver<Input>), String> {
        if !is_process_trusted() {
            prompt_accessibility();
            return Err(PERMISSION_ERROR_MESSAGE.into());
        }
        let provenance = Arc::new(Provenance::default());
        let hook_provenance = Arc::clone(&provenance);
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("ququ-keyboard-hook".into())
            .spawn(move || {
                let down = std::array::from_fn(|k| {
                    if k < 128 {
                        is_key_down(k as u16)
                    } else {
                        false
                    }
                });
                let mut context = Box::new(Context {
                    output: tx,
                    provenance: hook_provenance,
                    down,
                    tap: std::ptr::null_mut(),
                });
                let mask = (1u64 << NX_KEYDOWN) | (1u64 << NX_KEYUP) | (1u64 << NX_FLAGSCHANGED);
                let tap = unsafe {
                    CGEventTapCreate(
                        1, // kCGSessionEventTap
                        0, // kCGHeadInsertEventTap
                        1, // kCGEventTapOptionListenOnly
                        mask,
                        Some(callback),
                        context.as_mut() as *mut Context as *mut c_void,
                    )
                };
                if tap.is_null() {
                    let _ = ready_tx.send(Err(PERMISSION_ERROR_MESSAGE.into()));
                    return;
                }
                context.tap = tap;
                let source = unsafe { CFMachPortCreateRunLoopSource(std::ptr::null(), tap, 0) };
                if source.is_null() {
                    unsafe {
                        CFMachPortInvalidate(tap);
                        CFRelease(tap as *const c_void);
                    }
                    let _ = ready_tx.send(Err(
                        "Cannot install keyboard hook: failed to create run loop source".into(),
                    ));
                    return;
                }
                let run_loop = unsafe { CFRunLoopGetCurrent() };
                unsafe {
                    CFRunLoopAddSource(run_loop, source, kCFRunLoopCommonModes);
                    CGEventTapEnable(tap, true);
                }
                let _ = ready_tx.send(Ok(run_loop as usize));
                unsafe {
                    CFRunLoopRun();
                    CGEventTapEnable(tap, false);
                    CFRunLoopRemoveSource(run_loop, source, kCFRunLoopCommonModes);
                    CFMachPortInvalidate(tap);
                    CFRelease(source as *const c_void);
                    CFRelease(tap as *const c_void);
                }
            })
            .map_err(|e| e.to_string())?;

        match ready_rx.recv().map_err(|e| e.to_string())? {
            Ok(run_loop) => Ok((
                Self {
                    run_loop,
                    thread: Some(thread),
                    provenance,
                },
                rx,
            )),
            Err(e) => {
                let _ = thread.join();
                Err(e)
            }
        }
    }

    pub fn provenance(&self) -> Arc<Provenance> {
        Arc::clone(&self.provenance)
    }
}

impl Drop for Hook {
    fn drop(&mut self) {
        if self.run_loop != 0 {
            unsafe {
                CFRunLoopStop(self.run_loop as CFRunLoopRef);
                CFRunLoopWakeUp(self.run_loop as CFRunLoopRef);
            }
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modifier_masks_distinguish_left_and_right() {
        assert_eq!(
            modifier_mask(KEY_CONTROL_LEFT as usize),
            Some(NX_DEVICELCTLKEYMASK)
        );
        assert_eq!(
            modifier_mask(KEY_CONTROL_RIGHT as usize),
            Some(NX_DEVICERCTLKEYMASK)
        );
        assert_eq!(
            modifier_mask(KEY_SHIFT_LEFT as usize),
            Some(NX_DEVICELSHIFTKEYMASK)
        );
        assert_eq!(
            modifier_mask(KEY_SHIFT_RIGHT as usize),
            Some(NX_DEVICERSHIFTKEYMASK)
        );
        assert_eq!(
            modifier_mask(KEY_ALT_LEFT as usize),
            Some(NX_DEVICELALTKEYMASK)
        );
        assert_eq!(
            modifier_mask(KEY_ALT_RIGHT as usize),
            Some(NX_DEVICERALTKEYMASK)
        );
        assert_eq!(
            modifier_mask(KEY_COMMAND_LEFT as usize),
            Some(NX_DEVICELCMDKEYMASK)
        );
        assert_eq!(
            modifier_mask(KEY_COMMAND_RIGHT as usize),
            Some(NX_DEVICERCMDKEYMASK)
        );

        assert_eq!(modifier_mask(0), None);
        assert_eq!(modifier_mask(0x31), None); // Space
        assert_eq!(modifier_mask(0x24), None); // Return
    }

    #[test]
    fn provenance_configuration_and_counting() {
        let prov = Provenance::default();
        assert_eq!(prov.count(), 0);
        let id = prov.configure(KEY_CONTROL_LEFT, 0);
        assert_eq!(id, 0);
        prov.activations.fetch_add(1, Ordering::SeqCst);
        assert_eq!(prov.count(), 1);
        prov.set_capture(true);
        assert!(prov.capture.load(Ordering::SeqCst));
        prov.set_capture(false);
        assert!(!prov.capture.load(Ordering::SeqCst));
    }

    #[test]
    fn permission_error_message_is_actionable() {
        assert!(PERMISSION_ERROR_MESSAGE.contains("Accessibility"));
        assert!(PERMISSION_ERROR_MESSAGE.contains("Input Monitoring"));
        assert!(PERMISSION_ERROR_MESSAGE.contains("System Settings"));
    }

    #[test]
    fn hook_start_reports_permission_error_when_untrusted() {
        if !is_process_trusted() {
            let result = Hook::start();
            assert!(result.is_err());
            let err = result.err().unwrap();
            assert_eq!(err, PERMISSION_ERROR_MESSAGE);
        }
    }

    #[test]
    fn single_modifier_toggle_and_chording_on_machine() {
        use super::super::machine::{Action, Machine};
        let mut m = Machine::default();
        let target_vk = KEY_CONTROL_LEFT;

        // Clean press and release of target modifier -> Toggle
        assert_eq!(
            m.key(target_vk == KEY_CONTROL_LEFT, true, false, false),
            None
        );
        assert_eq!(
            m.key(target_vk == KEY_CONTROL_LEFT, false, false, false),
            Some(Action::Toggle)
        );

        // Press target modifier, then another key (chord) -> no toggle on release
        let mut m2 = Machine::default();
        assert_eq!(
            m2.key(target_vk == KEY_CONTROL_LEFT, true, false, false),
            None
        );
        assert_eq!(m2.key(false, true, false, false), None); // other key pressed
        assert_eq!(
            m2.key(target_vk == KEY_CONTROL_LEFT, false, false, false),
            None
        );

        // Right control does not trigger left control hotkey
        let mut m3 = Machine::default();
        assert_eq!(
            m3.key(KEY_CONTROL_RIGHT == KEY_CONTROL_LEFT, true, false, false),
            None
        );
        assert_eq!(
            m3.key(KEY_CONTROL_RIGHT == KEY_CONTROL_LEFT, false, false, false),
            None
        );
    }

    #[test]
    fn single_modifier_hold_mode_on_machine() {
        use super::super::machine::{Action, Machine};
        let mut m = Machine::default();
        m.hold = true;
        let target_vk = KEY_ALT_RIGHT;

        // Clean hold and release -> Start and Stop
        assert_eq!(
            m.key(target_vk == KEY_ALT_RIGHT, true, false, false),
            Some(Action::Start)
        );
        assert_eq!(
            m.key(target_vk == KEY_ALT_RIGHT, false, false, false),
            Some(Action::Stop)
        );

        // Hold and chord -> Cancel
        let mut m2 = Machine::default();
        m2.hold = true;
        assert_eq!(
            m2.key(target_vk == KEY_ALT_RIGHT, true, false, false),
            Some(Action::Start)
        );
        assert_eq!(m2.key(false, true, false, false), Some(Action::Cancel));
        assert_eq!(
            m2.key(target_vk == KEY_ALT_RIGHT, false, false, false),
            None
        );
    }
}
