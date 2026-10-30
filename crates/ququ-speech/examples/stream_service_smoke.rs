//! Exercise SpeechService streaming end to end against an extracted package.
//! Usage: stream_service_smoke <extracted_package_dir> <wav>
use ququ_speech::SpeechService;
use std::{env, fs, path::Path};

fn main() {
    let args: Vec<String> = env::args().collect();
    let package = Path::new(&args[1]);
    let root = tempfile_dir();
    let target = root.join("streaming-paraformer-bilingual-int8");
    fs::create_dir_all(&target).unwrap();
    for name in ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"] {
        fs::copy(package.join(name), target.join(name)).unwrap();
    }
    let service = SpeechService::new(&root).unwrap();
    let status = service.streaming_status().unwrap();
    println!("installed={} missing={:?}", status.installed, status.missing);
    let mut reader = hound::WavReader::open(&args[2]).unwrap();
    let samples: Vec<f32> = reader.samples::<i16>().map(|s| s.unwrap() as f32 / 32768.0).collect();
    let started = std::time::Instant::now();
    let mut session = service.start_stream().unwrap();
    println!("model load + session: {} ms", started.elapsed().as_millis());
    for chunk in samples.chunks(3200) {
        if let Some(draft) = session.push(chunk).unwrap() {
            println!("draft: {draft}");
        }
    }
    let result = service.finish_stream(&mut session, "zh", samples.len() as f64 / 16000.0).unwrap();
    println!("FINAL text={} | raw={} | warnings={:?}", result.text, result.raw_text, result.warnings);
    let second = std::time::Instant::now();
    let mut again = service.start_stream().unwrap();
    println!("second session start: {} ms", second.elapsed().as_millis());
    again.cancel();
    fs::remove_dir_all(&root).ok();
}

fn tempfile_dir() -> std::path::PathBuf {
    let dir = env::temp_dir().join(format!("ququ-stream-smoke-{}", std::process::id()));
    fs::create_dir_all(&dir).unwrap();
    dir
}
