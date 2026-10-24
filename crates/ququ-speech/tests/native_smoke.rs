#![cfg(feature = "native")]

use ququ_speech::{Engine, SpeechService, TranscribeOptions};
use std::io::Cursor;

/// Explicitly opt in with verified models and a known speech WAV. No network or
/// model download occurs in this test, and ordinary tests stay lightweight.
#[test]
#[ignore = "set QUQU_SPEECH_MODEL_ROOT and QUQU_SPEECH_TEST_WAV, then run --ignored"]
fn real_sensevoice_recognition_reuse_silence_and_failed_switch() {
    let root = std::env::var_os("QUQU_SPEECH_MODEL_ROOT").expect("QUQU_SPEECH_MODEL_ROOT");
    let wav = std::env::var_os("QUQU_SPEECH_TEST_WAV").expect("QUQU_SPEECH_TEST_WAV");
    let bytes = std::fs::read(wav).unwrap();
    let service = SpeechService::new(root).unwrap();
    assert!(
        service
            .status(Engine::SenseVoice)
            .unwrap()
            .models_downloaded
    );
    service.switch_engine(Engine::SenseVoice).unwrap();
    let first = service
        .transcribe_wav(&bytes, TranscribeOptions::default())
        .unwrap();
    assert!(first.success && !first.text.trim().is_empty());
    assert_eq!(first.engine, Engine::SenseVoice);
    assert_eq!(first.model_type, "onnx");
    assert!(service.status(Engine::SenseVoice).unwrap().initialized);

    // A missing optional engine must not destroy the already loaded engine.
    if !service
        .status(Engine::Paraformer)
        .unwrap()
        .models_downloaded
    {
        assert!(service.switch_engine(Engine::Paraformer).is_err());
        assert_eq!(service.current_engine(), Engine::SenseVoice);
    }
    let second = service
        .transcribe_wav(
            &bytes,
            TranscribeOptions {
                use_punc: false,
                use_vad: false,
                ..Default::default()
            },
        )
        .unwrap();
    assert!(second.success && !second.text.trim().is_empty());
    assert!((second.duration - first.duration).abs() < 0.000001);

    let mut silence = Cursor::new(Vec::new());
    {
        let mut writer = hound::WavWriter::new(
            &mut silence,
            hound::WavSpec {
                channels: 1,
                sample_rate: 16000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for _ in 0..16000 {
            writer.write_sample(0i16).unwrap();
        }
        writer.finalize().unwrap();
    }
    let silent = service
        .transcribe_wav(&silence.into_inner(), TranscribeOptions::default())
        .unwrap();
    assert!(
        silent.success && silent.text.is_empty(),
        "silence hallucinated: {}",
        silent.text
    );
    service.shutdown().unwrap();
    assert!(!service.status(Engine::SenseVoice).unwrap().initialized);
}
