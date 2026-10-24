//! Dedicated WH_KEYBOARD_LL thread. Hook callbacks only enqueue physical input;
//! they never block on application locks or consume a user's keystrokes.
use std::{
    cell::RefCell,
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    thread::{self, JoinHandle},
};
use windows_sys::Win32::{
    Foundation::{LPARAM, LRESULT, WPARAM},
    System::{LibraryLoader::GetModuleHandleW, Threading::GetCurrentThreadId},
    UI::WindowsAndMessaging::*,
};
#[derive(Clone, Copy)]
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
struct Context {
    output: Sender<Input>,
    provenance: Arc<Provenance>,
    down: [bool; 256],
}
thread_local! { static OUTPUT: RefCell<Option<Context>> = const { RefCell::new(None) }; }
unsafe extern "system" fn callback(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if code >= 0 && lp != 0 {
        let _ = std::panic::catch_unwind(|| {
            let data = unsafe { &*(lp as *const KBDLLHOOKSTRUCT) };
            if data.flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED) == 0 {
                let msg = wp as u32;
                if matches!(msg, WM_KEYDOWN | WM_KEYUP | WM_SYSKEYDOWN | WM_SYSKEYUP) {
                    OUTPUT.with(|out| {
                        if let Ok(mut out) = out.try_borrow_mut() {
                            if let Some(context) = out.as_mut() {
                                let pressed = matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN);
                                let vk = data.vkCode as usize;
                                if vk >= 256 {
                                    return;
                                }
                                let repeat = pressed && context.down[vk];
                                context.down[vk] = pressed;
                                let down = &context.down;
                                let mods = u32::from(down[0xA0] || down[0xA1])
                                    | (u32::from(down[0xA2] || down[0xA3]) << 1)
                                    | (u32::from(down[0xA4] || down[0xA5]) << 2)
                                    | (u32::from(down[0x5B] || down[0x5C]) << 3);
                                if pressed
                                    && !repeat
                                    && context.provenance.target.load(Ordering::SeqCst)
                                        == data.vkCode | (mods << 8)
                                {
                                    context
                                        .provenance
                                        .activations
                                        .fetch_add(1, Ordering::SeqCst);
                                }
                                let _ = context.output.send(Input {
                                    key: data.vkCode,
                                    pressed: matches!(msg, WM_KEYDOWN | WM_SYSKEYDOWN),
                                    captured: context.provenance.capture.load(Ordering::SeqCst),
                                });
                            }
                        }
                    });
                }
            }
        });
    }
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wp, lp) }
}
pub struct Hook {
    id: u32,
    thread: Option<JoinHandle<()>>,
    provenance: Arc<Provenance>,
}
impl Hook {
    pub fn start() -> Result<(Self, Receiver<Input>), String> {
        let provenance = Arc::new(Provenance::default());
        let hook_provenance = Arc::clone(&provenance);
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::sync_channel(1);
        let thread = thread::Builder::new()
            .name("ququ-keyboard-hook".into())
            .spawn(move || unsafe {
                // Force creation of the queue before publishing the ID used by PostThreadMessage.
                let mut msg: MSG = std::mem::zeroed();
                PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
                let down = std::array::from_fn(|vk| {
                    windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(vk as i32) < 0
                });
                OUTPUT.with(|out| {
                    *out.borrow_mut() = Some(Context {
                        output: tx,
                        provenance: hook_provenance,
                        down,
                    })
                });
                let hook = SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(callback),
                    GetModuleHandleW(std::ptr::null()),
                    0,
                );
                if hook.is_null() {
                    let _ = ready_tx.send(Err(std::io::Error::last_os_error().to_string()));
                    OUTPUT.with(|out| *out.borrow_mut() = None);
                    return;
                }
                let _ = ready_tx.send(Ok(GetCurrentThreadId()));
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                UnhookWindowsHookEx(hook);
                OUTPUT.with(|out| *out.borrow_mut() = None);
            })
            .map_err(|e| e.to_string())?;
        match ready_rx.recv().map_err(|e| e.to_string())? {
            Ok(id) => Ok((
                Self {
                    id,
                    thread: Some(thread),
                    provenance,
                },
                rx,
            )),
            Err(e) => {
                let _ = thread.join();
                Err(format!("Cannot install keyboard hook: {e}"))
            }
        }
    }
    pub fn provenance(&self) -> Arc<Provenance> {
        Arc::clone(&self.provenance)
    }
}
impl Drop for Hook {
    fn drop(&mut self) {
        unsafe {
            PostThreadMessageW(self.id, WM_QUIT, 0, 0);
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
    #[ignore = "requires an interactive Windows desktop"]
    fn native_hook_thread_starts_and_joins_cleanly() {
        let (hook, events) = Hook::start().expect("install WH_KEYBOARD_LL");
        drop(hook);
        // Input may arrive during the lifecycle check; drain it to check closure.
        while events.try_recv().is_ok() {}
        assert!(matches!(
            events.try_recv(),
            Err(mpsc::TryRecvError::Disconnected)
        ));
    }
}
