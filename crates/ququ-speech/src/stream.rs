//! Streaming recognition session contract.
//!
//! A draft is a full replacement snapshot of the text heard so far: it may get
//! shorter or be rewritten, so consumers must replace, never append. Only the
//! value returned by [`StreamSession::finish`] is final. Cancelling, failing or
//! dropping a session never promotes the latest draft to a final result.

use crate::{Result, SpeechError};

/// Engine-side half of a streaming session. Implemented by the native
/// recognizer and by test doubles.
pub trait StreamBackend: Send {
    /// Feed 16 kHz mono f32 samples and return the current draft, if the
    /// engine has one yet.
    fn accept(&mut self, samples: &[f32]) -> Result<Option<String>>;
    /// Signal end of input and return the engine's final text.
    fn finalize(&mut self) -> Result<String>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamState {
    Active,
    Finished,
    Cancelled,
    Failed,
}

pub struct StreamSession<B: StreamBackend> {
    backend: B,
    state: StreamState,
    draft: String,
}

impl<B: StreamBackend> StreamSession<B> {
    pub fn new(backend: B) -> Self {
        Self {
            backend,
            state: StreamState::Active,
            draft: String::new(),
        }
    }

    pub fn state(&self) -> &StreamState {
        &self.state
    }

    /// Latest draft snapshot; informational only, never a final result.
    pub fn draft(&self) -> &str {
        &self.draft
    }

    /// Push audio. Returns the new draft only when it differs from the last
    /// one, so callers can emit an event per change.
    pub fn push(&mut self, samples: &[f32]) -> Result<Option<&str>> {
        self.require_active()?;
        match self.backend.accept(samples) {
            Ok(Some(text)) if text != self.draft => {
                self.draft = text;
                Ok(Some(&self.draft))
            }
            Ok(_) => Ok(None),
            Err(error) => {
                self.state = StreamState::Failed;
                Err(error)
            }
        }
    }

    /// End the session and return the engine's final text.
    pub fn finish(&mut self) -> Result<String> {
        self.require_active()?;
        match self.backend.finalize() {
            Ok(text) => {
                self.state = StreamState::Finished;
                self.draft = text.clone();
                Ok(text)
            }
            Err(error) => {
                self.state = StreamState::Failed;
                Err(error)
            }
        }
    }

    /// Abandon the session. Idempotent; the draft is discarded, not committed.
    pub fn cancel(&mut self) {
        if self.state == StreamState::Active {
            self.state = StreamState::Cancelled;
            self.draft.clear();
        }
    }

    fn require_active(&self) -> Result<()> {
        if self.state == StreamState::Active {
            Ok(())
        } else {
            Err(SpeechError::Unsupported(format!(
                "stream session is {:?}",
                self.state
            )))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Script {
        drafts: Vec<Option<&'static str>>,
        final_text: Result<&'static str>,
        calls: usize,
    }

    impl Script {
        fn new(drafts: Vec<Option<&'static str>>, final_text: &'static str) -> Self {
            Self {
                drafts,
                final_text: Ok(final_text),
                calls: 0,
            }
        }
    }

    impl StreamBackend for Script {
        fn accept(&mut self, _: &[f32]) -> Result<Option<String>> {
            let draft = self.drafts.get(self.calls).copied().flatten();
            self.calls += 1;
            Ok(draft.map(str::to_owned))
        }
        fn finalize(&mut self) -> Result<String> {
            match &self.final_text {
                Ok(text) => Ok((*text).to_owned()),
                Err(_) => Err(SpeechError::Inference("boom".into())),
            }
        }
    }

    #[test]
    fn drafts_are_replacement_snapshots_and_repeats_are_suppressed() {
        let backend = Script::new(
            vec![Some("你好"), Some("你好"), Some("你好世"), Some("你好")],
            "你好。",
        );
        let mut session = StreamSession::new(backend);
        assert_eq!(session.push(&[0.0]).unwrap(), Some("你好"));
        assert_eq!(session.push(&[0.0]).unwrap(), None);
        assert_eq!(session.push(&[0.0]).unwrap(), Some("你好世"));
        // A revision that gets shorter is still delivered as a replacement.
        assert_eq!(session.push(&[0.0]).unwrap(), Some("你好"));
    }

    #[test]
    fn only_finish_returns_final_text_not_the_last_draft() {
        let mut session = StreamSession::new(Script::new(vec![Some("draft")], "final."));
        session.push(&[0.0]).unwrap();
        assert_eq!(session.draft(), "draft");
        assert_eq!(session.finish().unwrap(), "final.");
        assert_eq!(session.state(), &StreamState::Finished);
    }

    #[test]
    fn cancel_discards_the_draft_and_blocks_further_use() {
        let mut session = StreamSession::new(Script::new(vec![Some("draft")], "final."));
        session.push(&[0.0]).unwrap();
        session.cancel();
        session.cancel();
        assert_eq!(session.state(), &StreamState::Cancelled);
        assert_eq!(session.draft(), "");
        assert!(session.push(&[0.0]).is_err());
        assert!(session.finish().is_err());
    }

    #[test]
    fn finishing_twice_or_pushing_after_finish_is_rejected() {
        let mut session = StreamSession::new(Script::new(vec![], "done"));
        session.finish().unwrap();
        assert!(session.finish().is_err());
        assert!(session.push(&[0.0]).is_err());
    }

    #[test]
    fn engine_failure_marks_the_session_failed_and_never_commits_a_draft() {
        let mut backend = Script::new(vec![Some("draft")], "x");
        backend.final_text = Err(SpeechError::Inference("boom".into()));
        let mut session = StreamSession::new(backend);
        session.push(&[0.0]).unwrap();
        assert!(session.finish().is_err());
        assert_eq!(session.state(), &StreamState::Failed);
        assert!(session.push(&[0.0]).is_err());
    }

    #[test]
    fn cancel_after_finish_keeps_the_finished_state() {
        let mut session = StreamSession::new(Script::new(vec![], "done"));
        session.finish().unwrap();
        session.cancel();
        assert_eq!(session.state(), &StreamState::Finished);
    }
}
