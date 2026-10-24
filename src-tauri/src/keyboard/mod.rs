pub mod machine;
#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(windows)]
pub mod windows;

#[cfg(any(windows, target_os = "macos"))]
pub mod keycodes;
