use ququ_speech::{audio, available_models, Engine, SpeechService, TranscribeOptions};
use std::io::Cursor;

fn wav(samples: &[i16], channels: u16, rate: u32) -> Vec<u8> {
    let mut data = Cursor::new(Vec::new());
    let spec = hound::WavSpec {
        channels,
        sample_rate: rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    {
        let mut writer = hound::WavWriter::new(&mut data, spec).unwrap();
        for sample in samples {
            writer.write_sample(*sample).unwrap();
        }
        writer.finalize().unwrap();
    }
    data.into_inner()
}

#[test]
fn malformed_empty_and_truncated_audio_fail_before_model_initialization() {
    let dir = tempfile::tempdir().unwrap();
    let service = SpeechService::new(dir.path()).unwrap();
    for bytes in [
        vec![],
        b"not a wave".to_vec(),
        wav(&[], 1, 16000),
        wav(&[1, 2], 1, 16000)[..43].to_vec(),
    ] {
        let error = service
            .transcribe_wav(&bytes, TranscribeOptions::default())
            .unwrap_err();
        assert!(error.to_string().contains("audio"), "{error}");
    }
}

#[test]
fn stereo_pcm_is_mixed_and_duration_uses_frames() {
    let decoded = audio::decode_wav(&wav(&[32767, -32767, 16384, 16384], 2, 16000)).unwrap();
    assert_eq!(decoded.sample_rate, 16000);
    assert_eq!(decoded.samples.len(), 2);
    assert!(decoded.samples[0].abs() < 0.00001);
    assert!((decoded.samples[1] - 0.5).abs() < 0.0001);
    assert!((decoded.duration() - 0.000125).abs() < 0.000001);
}

#[test]
fn bounded_segments_preserve_every_sample_and_order() {
    let samples = vec![0.25; 16000 * 65];
    let chunks = audio::bounded_segments(&samples, 16000, 30).unwrap();
    assert_eq!(
        chunks.iter().map(|x| x.len()).collect::<Vec<_>>(),
        vec![480000, 480000, 80000]
    );
    assert_eq!(chunks.concat(), samples);
}

#[test]
fn partial_or_arbitrary_model_files_never_make_engine_ready() {
    let dir = tempfile::tempdir().unwrap();
    let service = SpeechService::new(dir.path()).unwrap();
    let status = service.status(Engine::SenseVoice).unwrap();
    assert!(!status.models_downloaded);
    assert!(!status.initialized);
    std::fs::create_dir_all(dir.path().join("sensevoice-int8-2024-07-17")).unwrap();
    std::fs::write(
        dir.path()
            .join("sensevoice-int8-2024-07-17/model.int8.onnx.part"),
        b"partial",
    )
    .unwrap();
    assert!(
        !service
            .status(Engine::SenseVoice)
            .unwrap()
            .models_downloaded
    );
}

#[test]
fn failed_switch_preserves_previous_selection() {
    let dir = tempfile::tempdir().unwrap();
    let service = SpeechService::new(dir.path()).unwrap();
    assert_eq!(service.current_engine(), Engine::SenseVoice);
    assert!(service.switch_engine(Engine::Paraformer).is_err());
    assert_eq!(service.current_engine(), Engine::SenseVoice);
}

#[test]
fn sensevoice_readiness_does_not_require_paraformer_or_punctuation() {
    let models = available_models();
    let sense = models
        .iter()
        .find(|x| x.engine == Engine::SenseVoice)
        .unwrap();
    assert!(sense.supports_builtin_punctuation);
    assert!(!sense.supports_hotwords);
    assert!(sense
        .required_files
        .iter()
        .all(|x| !x.contains("punc") && !x.contains("paraformer")));
}

#[test]
fn unsupported_hotwords_and_languages_fail_explicitly() {
    let dir = tempfile::tempdir().unwrap();
    let service = SpeechService::new(dir.path()).unwrap();
    let bytes = wav(&[1; 160], 1, 16000);
    let options = TranscribeOptions {
        hotword: "QuQu".into(),
        ..Default::default()
    };
    assert!(service
        .transcribe_wav(&bytes, options)
        .unwrap_err()
        .to_string()
        .contains("hotword"));
    let options = TranscribeOptions {
        language: "de".into(),
        ..Default::default()
    };
    assert!(service
        .transcribe_wav(&bytes, options)
        .unwrap_err()
        .to_string()
        .contains("language"));
}

#[test]
fn service_is_safe_for_desktop_shared_state() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<SpeechService>();
}

#[test]
fn model_integrity_detects_corruption_even_at_the_correct_length() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("model");
    std::fs::write(&path, b"hello").unwrap();
    let hash = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
    assert!(ququ_speech::models::verify_file(&path, 5, hash).unwrap());
    std::fs::write(&path, b"jello").unwrap();
    assert!(!ququ_speech::models::verify_file(&path, 5, hash).unwrap());
    assert!(!ququ_speech::models::verify_file(&path, 6, hash).unwrap());
}

#[test]
fn unsafe_paths_are_rejected_before_any_file_can_be_created() {
    let dir = tempfile::tempdir().unwrap();
    for path in [
        "../outside",
        "C:\\outside",
        "/outside",
        "models/../../outside",
        "",
    ] {
        assert!(
            ququ_speech::models::artifact_path(dir.path(), path).is_err(),
            "accepted {path}"
        );
    }
}

#[test]
fn oversized_audio_and_zero_segment_size_fail_without_allocation_of_samples() {
    let bytes = vec![0; audio::MAX_AUDIO_BYTES + 1];
    assert!(audio::decode_wav(&bytes).is_err());
    assert!(audio::bounded_segments(&[1.0], 16000, 0).is_err());
}

#[test]
fn legacy_model_name_and_missing_options_deserialize_compatibly() {
    assert_eq!(
        serde_json::from_str::<Engine>("\"sensevoice\"").unwrap(),
        Engine::SenseVoice
    );
    let options: TranscribeOptions = serde_json::from_str("{}").unwrap();
    assert_eq!(options.language, "zh");
    assert!(options.use_punc && options.use_vad);
    assert!(options.hotword.is_empty());
}
