use crate::{
    audio,
    models::{self, Artifact, DownloadProgress, Engine, ModelState},
    Result, SpeechError,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU8, Ordering},
        Mutex,
    },
    time::SystemTime,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct TranscribeOptions {
    pub language: String,
    pub use_punc: bool,
    pub use_vad: bool,
    pub hotword: String,
}

impl Default for TranscribeOptions {
    fn default() -> Self {
        Self {
            language: "zh".into(),
            use_punc: true,
            use_vad: true,
            hotword: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Transcription {
    pub success: bool,
    pub text: String,
    pub raw_text: String,
    pub confidence: f64,
    pub duration: f64,
    pub language: String,
    pub model_type: String,
    pub engine: Engine,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpeechStatus {
    pub success: bool,
    pub installed: bool,
    pub initialized: bool,
    pub models_downloaded: bool,
    pub engine: Engine,
    pub missing_models: Vec<String>,
    pub models: ModelState,
}

struct VerifiedFile {
    bytes: u64,
    modified: SystemTime,
    valid: bool,
}

/// Native model handles are owned behind one lock; inference, initialization,
/// and switching are serialized. Status uses atomics and a separate verification
/// cache so periodic UI polling need not wait for recognition to finish.
pub struct SpeechService {
    root: PathBuf,
    selected: AtomicU8,
    initialized: AtomicBool,
    verified: Mutex<HashMap<PathBuf, VerifiedFile>>,
    download_lock: Mutex<()>,
    #[cfg(feature = "native")]
    runtime: Mutex<Option<crate::native::NativeRuntime>>,
}

impl SpeechService {
    pub fn new(model_root: impl Into<PathBuf>) -> Result<Self> {
        let root = model_root.into();
        fs::create_dir_all(&root)?;
        Ok(Self {
            root: root.canonicalize()?,
            selected: AtomicU8::new(0),
            initialized: AtomicBool::new(false),
            verified: Mutex::new(HashMap::new()),
            download_lock: Mutex::new(()),
            #[cfg(feature = "native")]
            runtime: Mutex::new(None),
        })
    }

    pub fn current_engine(&self) -> Engine {
        match self.selected.load(Ordering::Acquire) {
            1 => Engine::Paraformer,
            _ => Engine::SenseVoice,
        }
    }

    pub fn model_root(&self) -> &Path {
        &self.root
    }

    pub fn status(&self, engine: Engine) -> Result<SpeechStatus> {
        let mut missing = Vec::new();
        let mut model_state = ModelState {
            asr: true,
            vad: true,
            punc: true,
        };
        for artifact in models::artifacts(engine) {
            if !self.check_artifact(artifact)? {
                missing.push(artifact.relative_path.to_owned());
                match artifact.role {
                    "asr" => model_state.asr = false,
                    "vad" => model_state.vad = false,
                    "punc" => model_state.punc = false,
                    _ => {}
                }
            }
        }
        let ready = missing.is_empty();
        Ok(SpeechStatus {
            success: ready && cfg!(feature = "native"),
            installed: cfg!(feature = "native"),
            initialized: ready
                && self.current_engine() == engine
                && self.initialized.load(Ordering::Acquire),
            models_downloaded: ready,
            engine,
            missing_models: missing,
            models: model_state,
        })
    }

    fn check_artifact(&self, artifact: Artifact) -> Result<bool> {
        let path = models::artifact_path(&self.root, artifact.relative_path)?;
        let metadata = match fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        if !metadata.is_file() || metadata.len() != artifact.bytes {
            return Ok(false);
        }
        let modified = metadata.modified()?;
        let mut cache = self
            .verified
            .lock()
            .map_err(|_| SpeechError::StatePoisoned)?;
        if let Some(previous) = cache.get(&path) {
            if previous.bytes == metadata.len() && previous.modified == modified {
                return Ok(previous.valid);
            }
        }
        let valid = models::verify_file(&path, artifact.bytes, artifact.sha256)?;
        cache.insert(
            path,
            VerifiedFile {
                bytes: metadata.len(),
                modified,
                valid,
            },
        );
        Ok(valid)
    }

    pub fn download_models(
        &self,
        engine: Engine,
        progress: impl FnMut(DownloadProgress),
    ) -> Result<SpeechStatus> {
        let _guard = self
            .download_lock
            .lock()
            .map_err(|_| SpeechError::StatePoisoned)?;
        models::download(&self.root, engine, progress)?;
        self.verified
            .lock()
            .map_err(|_| SpeechError::StatePoisoned)?
            .clear();
        self.status(engine)
    }

    fn require_models(&self, engine: Engine) -> Result<()> {
        let status = self.status(engine)?;
        if !status.models_downloaded {
            return Err(SpeechError::MissingModels(status.missing_models.join(", ")));
        }
        Ok(())
    }

    pub fn switch_engine(&self, engine: Engine) -> Result<SpeechStatus> {
        self.require_models(engine)?;
        #[cfg(feature = "native")]
        {
            let mut guard = self
                .runtime
                .lock()
                .map_err(|_| SpeechError::StatePoisoned)?;
            // Construct before changing selection: failure leaves the old runtime usable.
            let replacement = crate::native::NativeRuntime::new(&self.root, engine, "zh")?;
            *guard = Some(replacement);
            self.selected.store(
                if engine == Engine::Paraformer { 1 } else { 0 },
                Ordering::Release,
            );
            self.initialized.store(true, Ordering::Release);
            self.status(engine)
        }
        #[cfg(not(feature = "native"))]
        {
            Err(SpeechError::Unsupported(
                "native inference was disabled at build time".into(),
            ))
        }
    }

    pub fn transcribe_wav(
        &self,
        bytes: &[u8],
        options: TranscribeOptions,
    ) -> Result<Transcription> {
        // Untrusted audio/options fail before loading models or entering native code.
        let audio = audio::decode_wav(bytes)?;
        if !options.hotword.trim().is_empty() {
            return Err(SpeechError::Unsupported(
                "hotword biasing for SenseVoice/Paraformer".into(),
            ));
        }
        let allowed = ["zh", "en", "ja", "ko", "yue", "auto"];
        if !allowed.contains(&options.language.as_str()) {
            return Err(SpeechError::Unsupported(format!(
                "language {}",
                options.language
            )));
        }
        #[cfg(feature = "native")]
        {
            let mut guard = self
                .runtime
                .lock()
                .map_err(|_| SpeechError::StatePoisoned)?;
            let engine = self.current_engine();
            if engine == Engine::Paraformer && !["zh", "en"].contains(&options.language.as_str()) {
                return Err(SpeechError::Unsupported(format!(
                    "Paraformer language {}",
                    options.language
                )));
            }
            self.require_models(engine)?;
            if guard.as_ref().is_none_or(|runtime| {
                runtime.engine != engine || runtime.language != options.language
            }) {
                let replacement =
                    crate::native::NativeRuntime::new(&self.root, engine, &options.language)?;
                *guard = Some(replacement);
                self.initialized.store(true, Ordering::Release);
            }
            guard
                .as_ref()
                .ok_or_else(|| SpeechError::Inference("missing initialized runtime".into()))?
                .transcribe(audio, &options)
        }
        #[cfg(not(feature = "native"))]
        {
            let _ = audio;
            Err(SpeechError::Unsupported(
                "native inference was disabled at build time".into(),
            ))
        }
    }

    /// Release native handles; the next valid transcription lazily initializes.
    pub fn shutdown(&self) -> Result<()> {
        #[cfg(feature = "native")]
        {
            *self
                .runtime
                .lock()
                .map_err(|_| SpeechError::StatePoisoned)? = None;
        }
        self.initialized.store(false, Ordering::Release);
        Ok(())
    }
}
