//! Streaming Paraformer model package.
//!
//! The upstream publisher ships these weights only inside one large archive, so
//! the archive is pinned by length and SHA-256 and only three exact member
//! names are extracted. Nothing is written under the model root until the whole
//! archive and every member have verified, and archive paths are never joined
//! to the filesystem: each member maps to a fixed relative path.

use crate::{
    models::{artifact_path, copy_verified, verify_file},
    Result, SpeechError,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{self, Read},
    path::{Path, PathBuf},
    time::Duration,
};

pub struct Member {
    /// Exact entry name inside the archive.
    pub name: &'static str,
    pub relative_path: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
}

impl Member {
    pub(crate) fn as_artifact(&self) -> crate::models::Artifact {
        crate::models::Artifact {
            role: "asr",
            relative_path: self.relative_path,
            url: "",
            bytes: self.bytes,
            sha256: self.sha256,
        }
    }
}

pub struct Archive {
    pub url: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    pub members: &'static [Member],
}

const DIR: &str = "sherpa-onnx-streaming-paraformer-bilingual-zh-en";

// Hashes were computed from the published archive on 2026-10-30 and the
// extracted int8 files ran end to end in examples/stream_smoke.rs.
pub const STREAMING_PARAFORMER: Archive = Archive {
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2",
    bytes: 1047319737,
    sha256: "5462a1fce42693deae572af1e8c4687124b12aa85fe61ff4d3168bb5280e205f",
    members: &[
        Member {
            name: concat!("sherpa-onnx-streaming-paraformer-bilingual-zh-en", "/encoder.int8.onnx"),
            relative_path: "streaming-paraformer-bilingual-int8/encoder.int8.onnx",
            bytes: 165462184,
            sha256: "81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a",
        },
        Member {
            name: concat!("sherpa-onnx-streaming-paraformer-bilingual-zh-en", "/decoder.int8.onnx"),
            relative_path: "streaming-paraformer-bilingual-int8/decoder.int8.onnx",
            bytes: 71664561,
            sha256: "f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f",
        },
        Member {
            name: concat!("sherpa-onnx-streaming-paraformer-bilingual-zh-en", "/tokens.txt"),
            relative_path: "streaming-paraformer-bilingual-int8/tokens.txt",
            bytes: 75756,
            sha256: "59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6",
        },
    ],
};

#[allow(dead_code)]
const _: &str = DIR;

#[derive(Debug, Clone, Serialize)]
pub struct StreamModelStatus {
    pub installed: bool,
    pub missing: Vec<String>,
    pub download_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StreamDownloadProgress {
    pub stage: String,
    pub progress: f64,
    pub downloaded: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
}

pub fn status(root: &Path) -> Result<StreamModelStatus> {
    let mut missing = Vec::new();
    for member in STREAMING_PARAFORMER.members {
        let path = artifact_path(root, member.relative_path)?;
        if !verify_file(&path, member.bytes, member.sha256)? {
            missing.push(member.relative_path.to_owned());
        }
    }
    Ok(StreamModelStatus {
        installed: missing.is_empty(),
        missing,
        download_bytes: STREAMING_PARAFORMER.bytes,
    })
}

/// Encoder, decoder and tokens paths of an installed package.
pub fn paths(root: &Path) -> Result<(PathBuf, PathBuf, PathBuf)> {
    let members = STREAMING_PARAFORMER.members;
    Ok((
        artifact_path(root, members[0].relative_path)?,
        artifact_path(root, members[1].relative_path)?,
        artifact_path(root, members[2].relative_path)?,
    ))
}

pub(crate) fn download(
    root: &Path,
    mut callback: impl FnMut(StreamDownloadProgress),
) -> Result<()> {
    let archive = &STREAMING_PARAFORMER;
    let mut emit = |stage: &str, done: u64, error: Option<String>| {
        callback(StreamDownloadProgress {
            stage: stage.into(),
            progress: done as f64 * 100.0 / archive.bytes as f64,
            downloaded: done,
            total_bytes: archive.bytes,
            error,
        })
    };
    let result = (|| -> Result<()> {
        let client = reqwest::blocking::Client::builder()
            .https_only(true)
            .connect_timeout(Duration::from_secs(30))
            .timeout(Duration::from_secs(3600))
            .user_agent("QuQu/0.1 native-model-downloader")
            .build()?;
        let response = client.get(archive.url).send()?.error_for_status()?;
        if response
            .content_length()
            .is_some_and(|size| size != archive.bytes)
        {
            return Err(SpeechError::Integrity(
                "unexpected streaming model archive length".into(),
            ));
        }
        emit("downloading", 0, None);
        extract(response, root, archive, |done| emit("downloading", done, None))
    })();
    match result {
        Ok(()) => {
            emit("completed", archive.bytes, None);
            Ok(())
        }
        Err(error) => {
            emit("error", 0, Some(error.to_string()));
            Err(error)
        }
    }
}

struct Counting<R, F> {
    inner: R,
    hash: Sha256,
    count: u64,
    limit: u64,
    progress: F,
}

impl<R: Read, F: FnMut(u64)> Read for Counting<R, F> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let size = self.inner.read(buf)?;
        self.count += size as u64;
        if self.count > self.limit {
            return Err(io::Error::other("archive exceeded pinned length"));
        }
        self.hash.update(&buf[..size]);
        (self.progress)(self.count);
        Ok(size)
    }
}

/// Stream a bzip2 tar through verification, then install the pinned members.
pub(crate) fn extract(
    reader: impl Read,
    root: &Path,
    archive: &Archive,
    progress: impl FnMut(u64),
) -> Result<()> {
    let mut counting = Counting {
        inner: reader,
        hash: Sha256::new(),
        count: 0,
        limit: archive.bytes,
        progress,
    };
    let mut pending: Vec<(tempfile::NamedTempFile, PathBuf, usize)> = Vec::new();
    {
        let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(&mut counting));
        for entry in tar.entries()? {
            let mut entry = entry?;
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let name = entry.path()?.to_string_lossy().into_owned();
            let name = name.trim_start_matches("./");
            let Some(index) = archive.members.iter().position(|m| m.name == name) else {
                continue;
            };
            if pending.iter().any(|(_, _, seen)| *seen == index) {
                return Err(SpeechError::Integrity("duplicate archive member".into()));
            }
            let member = &archive.members[index];
            let target = artifact_path(root, member.relative_path)?;
            let parent = target
                .parent()
                .ok_or_else(|| SpeechError::Integrity("missing model parent".into()))?;
            fs::create_dir_all(parent)?;
            artifact_path(root, member.relative_path)?;
            let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
            copy_verified(
                &mut entry,
                temporary.as_file_mut(),
                member.bytes,
                member.sha256,
                |_| {},
            )?;
            temporary.as_file_mut().sync_all()?;
            pending.push((temporary, target, index));
        }
    }
    // Decoder buffering may leave unread trailing bytes; the archive hash covers them.
    io::copy(&mut counting, &mut io::sink())?;
    if counting.count != archive.bytes
        || format!("{:x}", counting.hash.clone().finalize()) != archive.sha256
    {
        return Err(SpeechError::Integrity(
            "archive size or SHA-256 mismatch".into(),
        ));
    }
    if pending.len() != archive.members.len() {
        return Err(SpeechError::Integrity("archive is missing a member".into()));
    }
    for (temporary, target, _) in pending {
        temporary
            .persist(&target)
            .map_err(|error| SpeechError::Io(error.error))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn sha(bytes: &[u8]) -> String {
        format!("{:x}", Sha256::digest(bytes))
    }

    /// Build a bzip2 tar from (name, data) pairs.
    fn archive_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut tar_bytes = Vec::new();
        {
            let mut builder = tar::Builder::new(&mut tar_bytes);
            for (name, data) in entries {
                let mut header = tar::Header::new_gnu();
                header.set_size(data.len() as u64);
                header.set_mode(0o644);
                // Raw name bytes: set_path would refuse the traversal entry under test.
                header.as_old_mut().name[..name.len()].copy_from_slice(name.as_bytes());
                header.set_cksum();
                builder.append(&header, *data).unwrap();
            }
            builder.finish().unwrap();
        }
        let mut encoder = bzip2::write::BzEncoder::new(Vec::new(), bzip2::Compression::fast());
        encoder.write_all(&tar_bytes).unwrap();
        encoder.finish().unwrap()
    }

    struct Fixture {
        archive: Vec<u8>,
        pinned: Archive,
    }

    fn leak(text: String) -> &'static str {
        Box::leak(text.into_boxed_str())
    }

    fn fixture(extra: &[(&str, &[u8])], tamper_member: bool) -> Fixture {
        let a: &[u8] = b"encoder bytes";
        let b: &[u8] = b"tokens";
        let mut entries: Vec<(&str, &[u8])> = vec![("pkg/a.bin", a)];
        entries.extend_from_slice(extra);
        entries.push(("pkg/b.txt", b));
        let archive = archive_bytes(&entries);
        let members: &'static [Member] = Box::leak(Box::new([
            Member {
                name: "pkg/a.bin",
                relative_path: "m/a.bin",
                bytes: a.len() as u64,
                sha256: if tamper_member {
                    leak(sha(b"different"))
                } else {
                    leak(sha(a))
                },
            },
            Member {
                name: "pkg/b.txt",
                relative_path: "m/b.txt",
                bytes: b.len() as u64,
                sha256: leak(sha(b)),
            },
        ]));
        let pinned = Archive {
            url: "",
            bytes: archive.len() as u64,
            sha256: leak(sha(&archive)),
            members,
        };
        Fixture { archive, pinned }
    }

    #[test]
    fn installs_only_pinned_members_and_ignores_unlisted_and_traversal_entries() {
        let f = fixture(&[("../evil", b"x"), ("pkg/extra.bin", b"y")], false);
        let dir = tempfile::tempdir().unwrap();
        extract(f.archive.as_slice(), dir.path(), &f.pinned, |_| {}).unwrap();
        assert_eq!(fs::read(dir.path().join("m/a.bin")).unwrap(), b"encoder bytes");
        assert_eq!(fs::read(dir.path().join("m/b.txt")).unwrap(), b"tokens");
        assert!(!dir.path().join("evil").exists());
        assert!(!dir.path().parent().unwrap().join("evil").exists());
        assert!(!dir.path().join("m/extra.bin").exists());
    }

    #[test]
    fn a_tampered_member_installs_nothing() {
        let f = fixture(&[], true);
        let dir = tempfile::tempdir().unwrap();
        assert!(extract(f.archive.as_slice(), dir.path(), &f.pinned, |_| {}).is_err());
        assert!(!dir.path().join("m/a.bin").exists());
        assert!(!dir.path().join("m/b.txt").exists());
    }

    #[test]
    fn a_wrong_archive_hash_installs_nothing_even_when_members_are_valid() {
        let mut f = fixture(&[], false);
        f.pinned.sha256 = leak(sha(b"not the archive"));
        let dir = tempfile::tempdir().unwrap();
        assert!(extract(f.archive.as_slice(), dir.path(), &f.pinned, |_| {}).is_err());
        assert!(!dir.path().join("m/a.bin").exists());
    }

    #[test]
    fn a_missing_member_is_an_error() {
        let f = fixture(&[], false);
        let mut short = archive_bytes(&[("pkg/a.bin", b"encoder bytes")]);
        let pinned = Archive {
            bytes: short.len() as u64,
            sha256: leak(sha(&short)),
            ..f.pinned
        };
        let dir = tempfile::tempdir().unwrap();
        assert!(extract(short.as_slice(), dir.path(), &pinned, |_| {}).is_err());
        short.clear();
    }

    #[test]
    fn a_truncated_archive_is_rejected() {
        let f = fixture(&[], false);
        let dir = tempfile::tempdir().unwrap();
        let cut = &f.archive[..f.archive.len() / 2];
        assert!(extract(cut, dir.path(), &f.pinned, |_| {}).is_err());
        assert!(!dir.path().join("m/a.bin").exists());
    }

    /// Needs the real archive: STREAM_ARCHIVE=/path/to/*.tar.bz2 cargo test -- --ignored
    #[test]
    #[ignore]
    fn real_archive_installs_and_matches_pinned_hashes() {
        let path = std::env::var("STREAM_ARCHIVE").expect("STREAM_ARCHIVE");
        let dir = tempfile::tempdir().unwrap();
        let file = fs::File::open(path).unwrap();
        extract(file, dir.path(), &STREAMING_PARAFORMER, |_| {}).unwrap();
        assert!(status(dir.path()).unwrap().installed);
    }
}
