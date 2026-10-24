//! cargo run --example smoke -- <model-root> <status|download|transcribe> [wav] [engine]
use ququ_speech::{Engine, SpeechService, TranscribeOptions};
use std::{path::PathBuf, str::FromStr};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        return Err(
            "usage: smoke <model-root> <status|download|transcribe> [wav] [sensevoice|paraformer]"
                .into(),
        );
    }
    let service = SpeechService::new(PathBuf::from(&args[1]))?;
    let engine = args
        .get(4)
        .map(|x| Engine::from_str(x))
        .transpose()?
        .unwrap_or_default();
    match args[2].as_str() {
        "status" => println!("{}", serde_json::to_string(&service.status(engine)?)?),
        "download" => {
            let mut last = -1i32;
            let status = service.download_models(engine, |progress| {
                let percent = progress.overall_progress as i32;
                if percent != last || progress.stage != "downloading" {
                    eprintln!("{}", serde_json::to_string(&progress).unwrap());
                    last = percent;
                }
            })?;
            println!("{}", serde_json::to_string(&status)?);
        }
        "transcribe" => {
            let path = args.get(3).ok_or("transcribe requires a WAV path")?;
            service.switch_engine(engine)?;
            let result =
                service.transcribe_wav(&std::fs::read(path)?, TranscribeOptions::default())?;
            println!("{}", serde_json::to_string(&result)?);
        }
        _ => return Err("unknown smoke command".into()),
    }
    Ok(())
}
