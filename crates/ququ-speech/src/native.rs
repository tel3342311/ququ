use crate::{
    audio::{self, DecodedAudio},
    models::{self, Engine},
    Result, SpeechError, TranscribeOptions, Transcription,
};
use sherpa_onnx::{
    LinearResampler, OfflineParaformerModelConfig, OfflinePunctuation, OfflinePunctuationConfig,
    OfflineRecognizer, OfflineRecognizerConfig, OfflineSenseVoiceModelConfig, SileroVadModelConfig,
    VadModelConfig, VoiceActivityDetector,
};
use std::path::Path;

pub(crate) struct NativeRuntime {
    pub engine: Engine,
    pub language: String,
    recognizer: OfflineRecognizer,
    punctuation: Option<OfflinePunctuation>,
    vad: VoiceActivityDetector,
}

impl NativeRuntime {
    pub fn new(root: &Path, engine: Engine, language: &str) -> Result<Self> {
        let filename = |relative| -> Result<String> {
            let path = models::artifact_path(root, relative)?;
            path.to_str()
                .map(str::to_owned)
                .ok_or_else(|| SpeechError::Inference("model path is not valid Unicode".into()))
        };
        let mut config = OfflineRecognizerConfig::default();
        config.model_config.num_threads = 4;
        config.model_config.provider = Some("cpu".into());
        config.decoding_method = Some("greedy_search".into());
        match engine {
            Engine::SenseVoice => {
                config.model_config.sense_voice = OfflineSenseVoiceModelConfig {
                    model: Some(filename(models::SENSE_MODEL.relative_path)?),
                    language: Some(language.into()),
                    use_itn: true,
                };
                config.model_config.tokens = Some(filename(models::SENSE_TOKENS.relative_path)?);
            }
            Engine::Paraformer => {
                config.model_config.paraformer = OfflineParaformerModelConfig {
                    model: Some(filename(models::PARA_MODEL.relative_path)?),
                };
                config.model_config.tokens = Some(filename(models::PARA_TOKENS.relative_path)?);
            }
        }
        let recognizer = OfflineRecognizer::create(&config)
            .ok_or_else(|| SpeechError::Inference("could not initialize ASR model".into()))?;
        let punctuation = if engine == Engine::Paraformer {
            let mut config = OfflinePunctuationConfig::default();
            config.model.ct_transformer = Some(filename(models::PUNC_MODEL.relative_path)?);
            config.model.num_threads = 2;
            Some(OfflinePunctuation::create(&config).ok_or_else(|| {
                SpeechError::Inference("could not initialize punctuation model".into())
            })?)
        } else {
            None
        };
        let vad_config = VadModelConfig {
            silero_vad: SileroVadModelConfig {
                model: Some(filename(models::VAD_MODEL.relative_path)?),
                threshold: 0.5,
                min_silence_duration: 0.5,
                min_speech_duration: 0.1,
                window_size: 512,
                max_speech_duration: 28.0,
            },
            ten_vad: Default::default(),
            sample_rate: 16000,
            num_threads: 1,
            provider: Some("cpu".into()),
            debug: false,
        };
        let vad = VoiceActivityDetector::create(&vad_config, 60.0)
            .ok_or_else(|| SpeechError::Inference("could not initialize VAD model".into()))?;
        Ok(Self {
            engine,
            language: language.into(),
            recognizer,
            punctuation,
            vad,
        })
    }

    pub fn transcribe(
        &self,
        audio: DecodedAudio,
        options: &TranscribeOptions,
    ) -> Result<Transcription> {
        let duration = audio.duration();
        let samples = if audio.sample_rate == 16000 {
            audio.samples
        } else {
            let resampler =
                LinearResampler::create(audio.sample_rate as i32, 16000).ok_or_else(|| {
                    SpeechError::Inference("could not initialize audio resampler".into())
                })?;
            let result = resampler.resample(&audio.samples, true);
            if result.is_empty() {
                return Err(SpeechError::Inference(
                    "audio resampling returned no samples".into(),
                ));
            }
            result
        };
        let mut pieces = Vec::new();
        let mut warnings = Vec::new();
        let decode = |segment: &[f32]| -> Result<String> {
            let stream = self.recognizer.create_stream();
            if self.engine == Engine::SenseVoice {
                stream.set_option("use_itn", if options.use_punc { "1" } else { "0" });
            }
            stream.accept_waveform(16000, segment);
            self.recognizer.decode(&stream);
            let result = stream.get_result().ok_or_else(|| {
                SpeechError::Inference("recognizer did not return a valid result".into())
            })?;
            Ok(result.text.trim().to_owned())
        };
        if self.engine == Engine::SenseVoice && options.use_vad {
            self.vad.reset();
            for chunk in samples.chunks(512) {
                self.vad.accept_waveform(chunk);
                while let Some(segment) = self.vad.front() {
                    for bounded in audio::bounded_segments(segment.samples(), 16000, 30)? {
                        pieces.push(decode(bounded)?);
                    }
                    self.vad.pop();
                }
            }
            self.vad.flush();
            while let Some(segment) = self.vad.front() {
                for bounded in audio::bounded_segments(segment.samples(), 16000, 30)? {
                    pieces.push(decode(bounded)?);
                }
                self.vad.pop();
            }
        } else if self.engine == Engine::SenseVoice {
            for bounded in audio::bounded_segments(&samples, 16000, 30)? {
                pieces.push(decode(bounded)?);
            }
        } else {
            // Existing Python Paraformer ran VAD but ignored its segments.
            // Keep whole-file recognition to avoid an unrelated behavior change.
            pieces.push(decode(&samples)?);
        }
        let separator = if options.language == "en" { " " } else { "" };
        let raw_text = pieces
            .into_iter()
            .filter(|piece| !piece.is_empty())
            .collect::<Vec<_>>()
            .join(separator);
        let mut text = raw_text.clone();
        if options.use_punc && !raw_text.is_empty() {
            if let Some(punctuation) = &self.punctuation {
                match punctuation.add_punctuation(&raw_text) {
                    Some(value) => text = value,
                    None => {
                        warnings.push("Punctuation failed; returned raw recognition text".into())
                    }
                }
            }
        }
        if options.language == "auto" {
            warnings.push(
                "Pinned Rust API does not expose detected language; language remains auto".into(),
            );
        }
        Ok(Transcription {
            success: true,
            text,
            raw_text,
            confidence: 0.0,
            duration,
            language: if options.language == "zh" {
                "zh-CN".into()
            } else {
                options.language.clone()
            },
            model_type: "onnx".into(),
            engine: self.engine,
            warnings,
        })
    }
}
