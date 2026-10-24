//! Opt-in fixed-WAV local ASR benchmark; emits no recognized text.
use ququ_speech::{audio, Engine, SpeechService, TranscribeOptions};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, time::Instant};
fn percentile(values: &[f64], quantile: f64) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    sorted[((sorted.len() as f64 * quantile).ceil() as usize).saturating_sub(1)]
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        return Err("usage: benchmark <verified-model-root> <fixed-wav>".into());
    }
    let bytes = std::fs::read(&args[2])?;
    let decoded = audio::decode_wav(&bytes)?;
    let duration = decoded.duration();
    let service = SpeechService::new(PathBuf::from(&args[1]))?;
    let before = Instant::now();
    let status = service.status(Engine::SenseVoice)?;
    if !status.models_downloaded {
        return Err("model integrity verification failed".into());
    }
    let verification_ms = before.elapsed().as_secs_f64() * 1000.;
    let before = Instant::now();
    service.switch_engine(Engine::SenseVoice)?;
    let model_initialization_ms = before.elapsed().as_secs_f64() * 1000.;
    let before = Instant::now();
    let first = service.transcribe_wav(&bytes, TranscribeOptions::default())?;
    if !first.success || first.text.trim().is_empty() {
        return Err("fixture produced empty recognition".into());
    }
    let first_recognition_ms = before.elapsed().as_secs_f64() * 1000.;
    let mut warm_ms = Vec::new();
    for _ in 0..30 {
        let before = Instant::now();
        let result = service.transcribe_wav(&bytes, TranscribeOptions::default())?;
        if !result.success || result.text.trim().is_empty() {
            return Err("warm recognition failed".into());
        }
        warm_ms.push(before.elapsed().as_secs_f64() * 1000.);
    }
    let rtf: Vec<f64> = warm_ms.iter().map(|ms| ms / 1000. / duration).collect();
    println!(
        "{}",
        serde_json::json!({
          "schema_version":1,"engine":"sensevoice-int8-2024-07-17","sherpa_onnx_version":"1.13.8",
          "provider":"cpu","asr_threads":4,"vad_threads":1,"language":"zh","use_vad":true,"use_punc":true,
          "os":std::env::consts::OS,"arch":std::env::consts::ARCH,
          "logical_cpus":std::thread::available_parallelism()?.get(),
          "fixture_sha256":format!("{:x}",Sha256::digest(&bytes)),"fixture_bytes":bytes.len(),
          "audio_seconds":duration,"audio_sample_rate":decoded.sample_rate,"runs":30,
          "verification_ms":verification_ms,"model_initialization_ms":model_initialization_ms,
          "first_recognition_ms":first_recognition_ms,"warm_ms":warm_ms,
          "warm_p50_ms":percentile(&warm_ms,0.5),"warm_p95_ms":percentile(&warm_ms,0.95),
          "warm_rtf_p50":percentile(&rtf,0.5),"warm_rtf_p95":percentile(&rtf,0.95)
        })
    );
    Ok(())
}
#[test]
fn nearest_rank_percentile() {
    assert_eq!(percentile(&[30., 10., 20.], 0.5), 20.);
    assert_eq!(percentile(&[30., 10., 20.], 0.95), 30.);
}
