//! Feed a 16 kHz mono WAV through the streaming backend in 200 ms chunks and
//! print each draft revision and the final text.
//! Usage: stream_smoke <model_dir> <wav> (model_dir holds encoder/decoder/tokens)
use ququ_speech::{native_stream::SherpaStream, stream::StreamSession};
use std::{env, path::Path, time::Instant};

fn main() {
    let args: Vec<String> = env::args().collect();
    let dir = Path::new(&args[1]);
    let mut reader = hound::WavReader::open(&args[2]).expect("open wav");
    let spec = reader.spec();
    assert_eq!((spec.channels, spec.sample_rate), (1, 16_000), "need 16 kHz mono");
    let samples: Vec<f32> = reader
        .samples::<i16>()
        .map(|s| s.expect("sample") as f32 / 32768.0)
        .collect();
    let backend = SherpaStream::new(
        &dir.join("encoder.int8.onnx"),
        &dir.join("decoder.int8.onnx"),
        &dir.join("tokens.txt"),
    )
    .expect("load model");
    let mut session = StreamSession::new(backend);
    let started = Instant::now();
    for chunk in samples.chunks(3_200) {
        if let Some(draft) = session.push(chunk).expect("push") {
            println!("[{:>5} ms] draft: {draft}", started.elapsed().as_millis());
        }
    }
    let text = session.finish().expect("finish");
    println!("[{:>5} ms] FINAL: {text}", started.elapsed().as_millis());
    println!("audio {:.1}s", samples.len() as f32 / 16_000.0);
}
