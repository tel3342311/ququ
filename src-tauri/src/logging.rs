use serde_json::json;
use std::{io::Write, path::Path};

static LOG_WRITER: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn write(root: &Path, level: &str, message: &str) -> Result<(), String> {
    write_record(root, "app.log", level, message)
}

pub fn speech(root: &Path, level: &str, message: &str) -> Result<(), String> {
    write_record(root, "speech.log", level, message)
}

fn write_record(root: &Path, file_name: &str, level: &str, message: &str) -> Result<(), String> {
    let _writer = LOG_WRITER.lock().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(root.join(file_name))
        .map_err(|e| e.to_string())?;
    writeln!(
        file,
        "{}",
        json!({"timestamp":chrono::Utc::now().to_rfc3339(),"level":level,"message":message})
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_messages_remain_separate_valid_json_lines() {
        let directory = tempfile::tempdir().unwrap();
        std::thread::scope(|scope| {
            for worker in 0..8 {
                let root = directory.path();
                scope.spawn(move || {
                    for index in 0..50 {
                        write(root, "info", &format!("worker {worker} message {index}")).unwrap();
                    }
                });
            }
        });
        let contents = std::fs::read_to_string(directory.path().join("app.log")).unwrap();
        assert_eq!(contents.lines().count(), 400);
        for line in contents.lines() {
            assert!(
                serde_json::from_str::<serde_json::Value>(line).is_ok(),
                "Invalid JSON log line: {line}"
            );
        }
    }
}
