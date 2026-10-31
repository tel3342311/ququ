//! Stream a WAV, then finish with the SenseVoice second pass and print both texts.
//! Usage: two_pass_smoke <streaming_dir> <sensevoice_dir> <silero_vad.onnx> <wav>
use ququ_speech::SpeechService;
use std::{env, fs, path::Path, time::Instant};

fn put(from: &Path, root: &Path, relative: &str) {
    let to = root.join(relative);
    fs::create_dir_all(to.parent().unwrap()).unwrap();
    fs::copy(from, to).unwrap();
}

fn main() {
    let a: Vec<String> = env::args().collect();
    let (stream_dir, sense_dir, vad, wav) = (Path::new(&a[1]), Path::new(&a[2]), Path::new(&a[3]), &a[4]);
    let root = env::temp_dir().join(format!("ququ-two-pass-{}", std::process::id()));
    for name in ["encoder.int8.onnx", "decoder.int8.onnx", "tokens.txt"] {
        put(&stream_dir.join(name), &root, &format!("streaming-paraformer-bilingual-int8/{name}"));
    }
    // Pass "-" as the SenseVoice directory to check the streaming-only fallback.
    if a[2] != "-" {
        for name in ["model.int8.onnx", "tokens.txt", "LICENSE"] {
            put(&sense_dir.join(name), &root, &format!("sensevoice-int8-2024-07-17/{name}"));
        }
        put(vad, &root, "silero-vad/silero_vad.onnx");
    }
    let service = SpeechService::new(&root).unwrap();
    let status = service.streaming_status().unwrap();
    println!("stream installed={} second_pass_ready={}", status.installed, status.second_pass_ready);

    let pcm: Vec<i16> = hound::WavReader::open(wav).unwrap().samples::<i16>().map(|s| s.unwrap()).collect();
    let mut session = service.start_stream().unwrap();
    for chunk in pcm.chunks(3200) {
        let f: Vec<f32> = chunk.iter().map(|&s| s as f32 / 32768.0).collect();
        session.push(&f).unwrap();
    }
    let started = Instant::now();
    let result = service.finish_stream_two_pass(&mut session, &pcm, "zh").unwrap();
    println!("finish (stream + load + second pass): {} ms", started.elapsed().as_millis());
    println!("STREAMING : {:?}", result.first_pass);
    println!("SECOND    : {}", result.text);
    println!("model_type={} engine={:?} warnings={:?}", result.model_type, result.engine, result.warnings);

    let mut again = service.start_stream().unwrap();
    for chunk in pcm.chunks(3200) {
        let f: Vec<f32> = chunk.iter().map(|&s| s as f32 / 32768.0).collect();
        again.push(&f).unwrap();
    }
    let t = Instant::now();
    let r2 = service.finish_stream_two_pass(&mut again, &pcm, "zh").unwrap();
    println!("second utterance finish (models warm): {} ms -> {}", t.elapsed().as_millis(), r2.text);
    fs::remove_dir_all(&root).ok();
}
