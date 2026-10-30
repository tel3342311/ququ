//! Python-free speech inference and integrity-checked model management.
//!
//! The service is synchronous: desktop hosts must call downloads, initialization,
//! and transcription on a blocking worker, never on their UI thread.

pub mod audio;
pub mod convert;
pub mod models;
#[cfg(feature = "native")]
mod native;
#[cfg(feature = "native")]
pub mod native_stream;
mod service;
pub mod stream;
pub mod stream_models;

pub use convert::{convert_for_language, to_traditional_tw};
pub use models::{available_models, DownloadProgress, Engine, ModelInfo, ModelState};
pub use service::{SpeechService, SpeechStatus, TranscribeOptions, Transcription};

#[derive(Debug, thiserror::Error)]
pub enum SpeechError {
    #[error("Invalid audio: {0}")]
    Audio(String),
    #[error("Missing or corrupt speech models: {0}")]
    MissingModels(String),
    #[error("Model integrity check failed: {0}")]
    Integrity(String),
    #[error("Unsupported speech capability: {0}")]
    Unsupported(String),
    #[error("Speech inference failed: {0}")]
    Inference(String),
    #[error("Speech service state lock was poisoned")]
    StatePoisoned,
    #[error("Speech model file I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("Speech model download: {0}")]
    Download(#[from] reqwest::Error),
}

pub type Result<T> = std::result::Result<T, SpeechError>;
