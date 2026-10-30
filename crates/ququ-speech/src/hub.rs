//! Owns the single active streaming session for a desktop host.
//!
//! The renderer addresses a session by id. Starting a new session cancels the
//! previous one, and a stale id can never push into or finish a newer session.

use crate::{
    stream::{StreamBackend, StreamSession},
    Result, SpeechError,
};
use std::sync::Mutex;

/// Largest single chunk accepted from the renderer (2 s at 16 kHz).
pub const MAX_CHUNK_SAMPLES: usize = 32_000;
/// A runaway session is cancelled after ten minutes of audio.
pub const MAX_SESSION_SAMPLES: u64 = 16_000 * 60 * 10;

struct Active<B: StreamBackend> {
    id: u64,
    session: StreamSession<B>,
    samples: u64,
}

pub struct StreamHub<B: StreamBackend> {
    inner: Mutex<(u64, Option<Active<B>>)>,
}

impl<B: StreamBackend> Default for StreamHub<B> {
    fn default() -> Self {
        Self {
            inner: Mutex::new((0, None)),
        }
    }
}

impl<B: StreamBackend> StreamHub<B> {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, (u64, Option<Active<B>>)>> {
        self.inner.lock().map_err(|_| SpeechError::StatePoisoned)
    }

    /// Register a session, cancelling any previous one. Returns its id.
    pub fn start(&self, session: StreamSession<B>) -> Result<u64> {
        let mut guard = self.lock()?;
        if let Some(mut old) = guard.1.take() {
            old.session.cancel();
        }
        guard.0 += 1;
        let id = guard.0;
        guard.1 = Some(Active {
            id,
            session,
            samples: 0,
        });
        Ok(id)
    }

    /// Push 16-bit PCM. Returns a new draft only when it changed.
    pub fn push(&self, id: u64, pcm: &[i16]) -> Result<Option<String>> {
        if pcm.len() > MAX_CHUNK_SAMPLES {
            return Err(SpeechError::Audio("stream chunk is too large".into()));
        }
        let mut guard = self.lock()?;
        let active = match guard.1.as_mut() {
            Some(active) if active.id == id => active,
            _ => return Err(SpeechError::Unsupported("stale stream session".into())),
        };
        active.samples += pcm.len() as u64;
        if active.samples > MAX_SESSION_SAMPLES {
            if let Some(mut over) = guard.1.take() {
                over.session.cancel();
            }
            return Err(SpeechError::Audio("stream session is too long".into()));
        }
        let samples: Vec<f32> = pcm.iter().map(|&s| s as f32 / 32768.0).collect();
        let result = active
            .session
            .push(&samples)
            .map(|draft| draft.map(str::to_owned));
        if result.is_err() {
            guard.1 = None;
        }
        result
    }

    /// Take the session out for finishing. The hub is empty afterwards, so the
    /// same id cannot be finished twice. Returns the session and its duration.
    pub fn take(&self, id: u64) -> Result<(StreamSession<B>, f64)> {
        let mut guard = self.lock()?;
        match guard.1.take() {
            Some(active) if active.id == id => {
                Ok((active.session, active.samples as f64 / 16_000.0))
            }
            other => {
                guard.1 = other;
                Err(SpeechError::Unsupported("stale stream session".into()))
            }
        }
    }

    /// Cancel the session with this id. A stale id is ignored.
    pub fn cancel(&self, id: u64) -> Result<()> {
        let mut guard = self.lock()?;
        if guard.1.as_ref().is_some_and(|active| active.id == id) {
            if let Some(mut active) = guard.1.take() {
                active.session.cancel();
            }
        }
        Ok(())
    }

    /// Cancel whatever is active (used when dictation is invalidated).
    pub fn cancel_all(&self) -> Result<()> {
        if let Some(mut active) = self.lock()?.1.take() {
            active.session.cancel();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Echo(usize);
    impl StreamBackend for Echo {
        fn accept(&mut self, samples: &[f32]) -> Result<Option<String>> {
            self.0 += samples.len();
            Ok(Some(format!("{} samples", self.0)))
        }
        fn finalize(&mut self) -> Result<String> {
            Ok(format!("final {}", self.0))
        }
    }

    fn session() -> StreamSession<Echo> {
        StreamSession::new(Echo(0))
    }

    #[test]
    fn push_returns_draft_and_take_returns_session_and_duration() {
        let hub = StreamHub::default();
        let id = hub.start(session()).unwrap();
        assert_eq!(hub.push(id, &[0; 8000]).unwrap().as_deref(), Some("8000 samples"));
        let (mut taken, seconds) = hub.take(id).unwrap();
        assert_eq!(seconds, 0.5);
        assert_eq!(taken.finish().unwrap(), "final 8000");
    }

    #[test]
    fn a_new_session_cancels_the_old_one_and_stale_ids_are_rejected() {
        let hub = StreamHub::default();
        let first = hub.start(session()).unwrap();
        let second = hub.start(session()).unwrap();
        assert_ne!(first, second);
        assert!(hub.push(first, &[0; 10]).is_err());
        assert!(hub.take(first).is_err());
        // A rejected stale take must not disturb the live session.
        assert!(hub.push(second, &[0; 10]).is_ok());
    }

    #[test]
    fn a_session_can_be_finished_only_once() {
        let hub = StreamHub::default();
        let id = hub.start(session()).unwrap();
        hub.take(id).unwrap();
        assert!(hub.take(id).is_err());
        assert!(hub.push(id, &[0; 10]).is_err());
    }

    #[test]
    fn cancel_is_idempotent_and_ignores_stale_ids() {
        let hub = StreamHub::default();
        let id = hub.start(session()).unwrap();
        hub.cancel(id + 99).unwrap();
        assert!(hub.push(id, &[0; 10]).is_ok());
        hub.cancel(id).unwrap();
        hub.cancel(id).unwrap();
        assert!(hub.push(id, &[0; 10]).is_err());
    }

    #[test]
    fn oversized_chunks_are_rejected_and_overlong_sessions_are_cancelled() {
        let hub = StreamHub::default();
        let id = hub.start(session()).unwrap();
        assert!(hub.push(id, &vec![0; MAX_CHUNK_SAMPLES + 1]).is_err());
        assert!(hub.push(id, &[0; 10]).is_ok(), "oversize must not kill the session");
        let chunk = vec![0i16; MAX_CHUNK_SAMPLES];
        let mut result = Ok(None);
        for _ in 0..(MAX_SESSION_SAMPLES / MAX_CHUNK_SAMPLES as u64 + 1) {
            result = hub.push(id, &chunk);
            if result.is_err() {
                break;
            }
        }
        assert!(result.is_err());
        assert!(hub.push(id, &[0; 10]).is_err());
    }
}
