use crate::{stream::StreamBackend, Result, SpeechError};
use sherpa_onnx::{
    OfflinePunctuation, OfflinePunctuationConfig, OnlineParaformerModelConfig, OnlineRecognizer,
    OnlineRecognizerConfig, OnlineStream,
};
use std::{path::Path, sync::Arc};

const SAMPLE_RATE: i32 = 16_000;
/// Trailing silence fed before input_finished so the last word is flushed.
const TAIL_SECONDS: f32 = 0.5;

fn utf8(path: &Path) -> Result<String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| SpeechError::Inference("model path is not valid Unicode".into()))
}

/// Loaded streaming model. Loading is the slow part, so one runtime serves many
/// utterances; each utterance gets its own cheap [`SherpaStream`].
pub struct StreamRuntime {
    recognizer: Arc<OnlineRecognizer>,
    punctuation: Option<OfflinePunctuation>,
}

impl StreamRuntime {
    pub fn new(
        encoder: &Path,
        decoder: &Path,
        tokens: &Path,
        punctuation: Option<&Path>,
    ) -> Result<Self> {
        let mut config = OnlineRecognizerConfig::default();
        config.model_config.paraformer = OnlineParaformerModelConfig {
            encoder: Some(utf8(encoder)?),
            decoder: Some(utf8(decoder)?),
        };
        config.model_config.tokens = Some(utf8(tokens)?);
        config.model_config.num_threads = 2;
        config.model_config.provider = Some("cpu".into());
        config.decoding_method = Some("greedy_search".into());
        let recognizer = OnlineRecognizer::create(&config).ok_or_else(|| {
            SpeechError::Inference("could not initialize streaming ASR model".into())
        })?;
        let punctuation = match punctuation {
            Some(path) => {
                let mut config = OfflinePunctuationConfig::default();
                config.model.ct_transformer = Some(utf8(path)?);
                config.model.num_threads = 2;
                Some(OfflinePunctuation::create(&config).ok_or_else(|| {
                    SpeechError::Inference("could not initialize punctuation model".into())
                })?)
            }
            None => None,
        };
        Ok(Self {
            recognizer: Arc::new(recognizer),
            punctuation,
        })
    }

    pub fn session(&self) -> SherpaStream {
        SherpaStream {
            stream: self.recognizer.create_stream(),
            recognizer: self.recognizer.clone(),
        }
    }

    /// Add punctuation to final text; None when unavailable or the model fails.
    pub fn punctuate(&self, text: &str) -> Option<String> {
        self.punctuation.as_ref()?.add_punctuation(text)
    }
}

/// One utterance on a shared streaming recognizer.
pub struct SherpaStream {
    recognizer: Arc<OnlineRecognizer>,
    stream: OnlineStream,
}

impl SherpaStream {
    /// Standalone constructor for tools that do not need runtime sharing.
    pub fn new(encoder: &Path, decoder: &Path, tokens: &Path) -> Result<Self> {
        Ok(StreamRuntime::new(encoder, decoder, tokens, None)?.session())
    }

    fn decode_ready(&self) {
        while self.recognizer.is_ready(&self.stream) {
            self.recognizer.decode(&self.stream);
        }
    }

    fn text(&self) -> String {
        self.recognizer
            .get_result(&self.stream)
            .map(|result| result.text.trim().to_owned())
            .unwrap_or_default()
    }
}

impl StreamBackend for SherpaStream {
    fn accept(&mut self, samples: &[f32]) -> Result<Option<String>> {
        self.stream.accept_waveform(SAMPLE_RATE, samples);
        self.decode_ready();
        let text = self.text();
        Ok((!text.is_empty()).then_some(text))
    }

    fn finalize(&mut self) -> Result<String> {
        let tail = vec![0.0f32; (SAMPLE_RATE as f32 * TAIL_SECONDS) as usize];
        self.stream.accept_waveform(SAMPLE_RATE, &tail);
        self.stream.input_finished();
        self.decode_ready();
        Ok(self.text())
    }
}
