use crate::{Result, SpeechError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    str::FromStr,
    time::Duration,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum Engine {
    #[default]
    #[serde(rename = "sense_voice", alias = "sensevoice")]
    SenseVoice,
    #[serde(rename = "paraformer")]
    Paraformer,
}

impl FromStr for Engine {
    type Err = SpeechError;
    fn from_str(value: &str) -> Result<Self> {
        match value {
            "sense_voice" | "sensevoice" | "SenseVoice" => Ok(Self::SenseVoice),
            "paraformer" | "Paraformer" => Ok(Self::Paraformer),
            _ => Err(SpeechError::Unsupported(format!("engine {value}"))),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelInfo {
    pub engine: Engine,
    pub name: String,
    pub variant: String,
    pub languages: Vec<String>,
    pub supports_builtin_punctuation: bool,
    pub supports_hotwords: bool,
    pub required_files: Vec<String>,
    pub download_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelState {
    pub asr: bool,
    pub vad: bool,
    pub punc: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub stage: String,
    pub model: String,
    pub progress: f64,
    pub overall_progress: f64,
    pub completed: usize,
    pub total: usize,
    pub engine: Engine,
    pub downloaded: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy)]
pub struct Artifact {
    pub role: &'static str,
    pub relative_path: &'static str,
    pub url: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

// SHA-256 weight digests are the upstream publisher's Hugging Face LFS OIDs.
// Small files were independently fetched and hashed on 2026-10-23.
// Revision-pinned individual files avoid extracting untrusted model archives.
pub const SENSE_MODEL: Artifact = Artifact {
    role: "asr", relative_path: "sensevoice-int8-2024-07-17/model.int8.onnx",
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx",
    bytes: 239233841, sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51",
};
pub const SENSE_TOKENS: Artifact = Artifact {
    role: "asr", relative_path: "sensevoice-int8-2024-07-17/tokens.txt",
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt",
    bytes: 315894, sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc",
};
pub const SENSE_LICENSE: Artifact = Artifact {
    role: "asr", relative_path: "sensevoice-int8-2024-07-17/LICENSE",
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/LICENSE",
    bytes: 71, sha256: "221c6df10b0931a5629adad671ea48fb7747e034c414b6d2bfa275bc3dd4ea17",
};
pub const PARA_MODEL: Artifact = Artifact {
    role: "asr", relative_path: "paraformer-fp32-2024-03-09/model.onnx",
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09/resolve/906992d326ebf0c5171cde675aa0902be9e5bc6c/model.onnx",
    bytes: 822641426, sha256: "ed302fb061dcb65655b5240f5f8cd18d6d6c2f5c2b5cb63184d413d728bc1ec4",
};
pub const PARA_TOKENS: Artifact = Artifact {
    role: "asr", relative_path: "paraformer-fp32-2024-03-09/tokens.txt",
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09/resolve/906992d326ebf0c5171cde675aa0902be9e5bc6c/tokens.txt",
    bytes: 75354, sha256: "6c0e3b35cece259829e6cb5b8d90d13db88f61ea3a2953d11898e4b2bfd7a2e2",
};
pub const PUNC_MODEL: Artifact = Artifact {
    role: "punc", relative_path: "punctuation-fp32-2024-04-12/model.onnx",
    url: "https://huggingface.co/csukuangfj/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12/resolve/432aeba669265e7aeb06b9359753419683b38597/model.onnx",
    bytes: 294372519, sha256: "e93593a6dbd69a07f8734ef269dbe861a379755f8d1c8354719432116f2c44bd",
};
pub const VAD_MODEL: Artifact = Artifact {
    role: "vad",
    relative_path: "silero-vad/silero_vad.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
    bytes: 643854,
    sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
};

pub fn artifacts(engine: Engine) -> Vec<Artifact> {
    match engine {
        Engine::SenseVoice => vec![SENSE_MODEL, SENSE_TOKENS, SENSE_LICENSE, VAD_MODEL],
        Engine::Paraformer => vec![PARA_MODEL, PARA_TOKENS, PUNC_MODEL, VAD_MODEL],
    }
}

pub fn available_models() -> Vec<ModelInfo> {
    [Engine::SenseVoice, Engine::Paraformer]
        .into_iter()
        .map(|engine| {
            let files = artifacts(engine);
            ModelInfo {
                engine,
                name: match engine {
                    Engine::SenseVoice => "SenseVoice Small",
                    Engine::Paraformer => "Paraformer Large",
                }
                .into(),
                variant: match engine {
                    Engine::SenseVoice => "int8",
                    Engine::Paraformer => "fp32",
                }
                .into(),
                languages: match engine {
                    Engine::SenseVoice => vec!["zh", "yue", "en", "ja", "ko", "auto"],
                    Engine::Paraformer => vec!["zh", "en"],
                }
                .into_iter()
                .map(str::to_owned)
                .collect(),
                supports_builtin_punctuation: engine == Engine::SenseVoice,
                supports_hotwords: false,
                download_bytes: files.iter().map(|x| x.bytes).sum(),
                required_files: files.iter().map(|x| x.relative_path.to_owned()).collect(),
            }
        })
        .collect()
}

/// Manifest paths are relative normal components only. Refuse symlinked parents
/// so even a locally replaced model subdirectory cannot escape model_root.
pub fn artifact_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if path.components().next().is_none()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(SpeechError::Integrity("unsafe model path".into()));
    }
    let mut candidate = root.to_path_buf();
    for part in path.components() {
        candidate.push(part.as_os_str());
        if let Ok(meta) = fs::symlink_metadata(&candidate) {
            if meta.file_type().is_symlink() {
                return Err(SpeechError::Integrity("symlinked model path".into()));
            }
        }
    }
    Ok(candidate)
}

pub fn verify_file(path: &Path, expected_bytes: u64, sha256: &str) -> Result<bool> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if !file.metadata()?.is_file() || file.metadata()?.len() != expected_bytes {
        return Ok(false);
    }
    let mut reader = std::io::BufReader::new(file);
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        let size = reader.read(&mut buffer)?;
        if size == 0 {
            break;
        }
        hash.update(&buffer[..size]);
    }
    Ok(format!("{:x}", hash.finalize()) == sha256)
}

pub(crate) fn download(
    root: &Path,
    engine: Engine,
    mut callback: impl FnMut(DownloadProgress),
) -> Result<()> {
    let client = reqwest::blocking::Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(3600))
        .user_agent("QuQu/0.1 native-model-downloader")
        .build()?;
    let list = artifacts(engine);
    let total_bytes = list.iter().map(|x| x.bytes).sum::<u64>();
    let mut done_bytes = 0;
    for (completed, artifact) in list.iter().enumerate() {
        let target = artifact_path(root, artifact.relative_path)?;
        let emit = |stage: &str,
                    bytes: u64,
                    error: Option<String>,
                    callback: &mut dyn FnMut(DownloadProgress)| {
            callback(DownloadProgress {
                stage: stage.into(),
                model: artifact.role.into(),
                engine,
                progress: bytes as f64 * 100.0 / artifact.bytes as f64,
                overall_progress: (done_bytes + bytes) as f64 * 100.0 / total_bytes as f64,
                completed: completed + usize::from(stage == "completed"),
                total: list.len(),
                downloaded: done_bytes + bytes,
                total_bytes,
                error,
            });
        };
        if verify_file(&target, artifact.bytes, artifact.sha256)? {
            emit("completed", artifact.bytes, None, &mut callback);
            done_bytes += artifact.bytes;
            continue;
        }
        let attempt = (|| -> Result<()> {
            let parent = target
                .parent()
                .ok_or_else(|| SpeechError::Integrity("missing model parent".into()))?;
            fs::create_dir_all(parent)?;
            // Re-check after creation, before opening the temporary file.
            artifact_path(root, artifact.relative_path)?;
            let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
            let mut response = client.get(artifact.url).send()?.error_for_status()?;
            if response
                .content_length()
                .is_some_and(|size| size != artifact.bytes)
            {
                return Err(SpeechError::Integrity(format!(
                    "unexpected download length for {}",
                    artifact.relative_path
                )));
            }
            emit("downloading", 0, None, &mut callback);
            copy_verified(
                &mut response,
                temporary.as_file_mut(),
                artifact.bytes,
                artifact.sha256,
                |bytes| {
                    emit("downloading", bytes, None, &mut callback);
                },
            )?;
            temporary.as_file_mut().sync_all()?;
            temporary
                .persist(&target)
                .map_err(|error| SpeechError::Io(error.error))?;
            Ok(())
        })();
        if let Err(error) = attempt {
            emit("error", 0, Some(error.to_string()), &mut callback);
            return Err(error);
        }
        emit("completed", artifact.bytes, None, &mut callback);
        done_bytes += artifact.bytes;
    }
    Ok(())
}

pub(crate) fn copy_verified(
    reader: &mut impl Read,
    writer: &mut impl Write,
    expected_bytes: u64,
    expected_hash: &str,
    mut progress: impl FnMut(u64),
) -> Result<()> {
    let mut received = 0u64;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        received += count as u64;
        if received > expected_bytes {
            return Err(SpeechError::Integrity(
                "download exceeded pinned length".into(),
            ));
        }
        writer.write_all(&buffer[..count])?;
        hash.update(&buffer[..count]);
        progress(received);
    }
    if received != expected_bytes || format!("{:x}", hash.finalize()) != expected_hash {
        return Err(SpeechError::Integrity(
            "download size or SHA-256 mismatch".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    const HELLO_HASH: &str = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    #[test]
    fn streaming_download_rejects_truncation_extra_bytes_and_corruption() {
        for bytes in [
            b"hell".as_slice(),
            b"hello!".as_slice(),
            b"jello".as_slice(),
        ] {
            let mut output = Vec::new();
            assert!(
                copy_verified(&mut Cursor::new(bytes), &mut output, 5, HELLO_HASH, |_| {}).is_err()
            );
        }
        let mut output = Vec::new();
        let mut progress = Vec::new();
        copy_verified(
            &mut Cursor::new(b"hello"),
            &mut output,
            5,
            HELLO_HASH,
            |n| progress.push(n),
        )
        .unwrap();
        assert_eq!(output, b"hello");
        assert_eq!(progress.last(), Some(&5));
    }

    #[test]
    fn interrupted_reader_cannot_report_a_verified_download() {
        struct Interrupted;
        impl Read for Interrupted {
            fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> {
                Err(std::io::Error::new(
                    std::io::ErrorKind::ConnectionReset,
                    "test disconnect",
                ))
            }
        }
        assert!(copy_verified(&mut Interrupted, &mut Vec::new(), 5, HELLO_HASH, |_| {}).is_err());
    }
}
