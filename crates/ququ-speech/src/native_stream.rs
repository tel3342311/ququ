use crate::{stream::StreamBackend, Result, SpeechError};
use sherpa_onnx::{OnlineParaformerModelConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream};
use std::path::Path;

const SAMPLE_RATE: i32 = 16_000;
/// Trailing silence fed before input_finished so the last word is flushed.
const TAIL_SECONDS: f32 = 0.5;

/// Streaming Paraformer recognizer bound to one utterance.
pub(crate) struct SherpaStream {
    recognizer: OnlineRecognizer,
    stream: OnlineStream,
}

impl SherpaStream {
    pub fn new(encoder: &Path, decoder: &Path, tokens: &Path) -> Result<Self> {
        let text = |path: &Path| -> Result<String> {
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| SpeechError::Inference("model path is not valid Unicode".into()))
        };
        let mut config = OnlineRecognizerConfig::default();
        config.model_config.paraformer = OnlineParaformerModelConfig {
            encoder: Some(text(encoder)?),
            decoder: Some(text(decoder)?),
        };
        config.model_config.tokens = Some(text(tokens)?);
        config.model_config.num_threads = 2;
        config.model_config.provider = Some("cpu".into());
        config.decoding_method = Some("greedy_search".into());
        let recognizer = OnlineRecognizer::create(&config).ok_or_else(|| {
            SpeechError::Inference("could not initialize streaming ASR model".into())
        })?;
        let stream = recognizer.create_stream();
        Ok(Self { recognizer, stream })
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
