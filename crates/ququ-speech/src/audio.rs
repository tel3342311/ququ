use crate::{Result, SpeechError};
use std::io::Cursor;

/// Reject large input before parsing or allocating decoded samples.
pub const MAX_AUDIO_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_AUDIO_SECONDS: f64 = 300.0;

#[derive(Debug)]
pub struct DecodedAudio {
    pub sample_rate: u32,
    pub samples: Vec<f32>,
}

impl DecodedAudio {
    pub fn duration(&self) -> f64 {
        self.samples.len() as f64 / self.sample_rate as f64
    }
}

pub fn decode_wav(bytes: &[u8]) -> Result<DecodedAudio> {
    let invalid = |message: &str| SpeechError::Audio(message.into());
    if bytes.len() < 44 || bytes.len() > MAX_AUDIO_BYTES {
        return Err(invalid("WAV must contain samples and fit within 64 MiB"));
    }
    if &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err(invalid("expected a RIFF/WAVE file"));
    }
    let declared = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if declared.checked_add(8) != Some(bytes.len()) {
        return Err(invalid("truncated or inconsistent RIFF length"));
    }
    let mut reader =
        hound::WavReader::new(Cursor::new(bytes)).map_err(|e| SpeechError::Audio(e.to_string()))?;
    let spec = reader.spec();
    if spec.sample_format != hound::SampleFormat::Int || spec.bits_per_sample != 16 {
        return Err(invalid("only PCM16 WAV is supported"));
    }
    if !(1..=2).contains(&spec.channels) || !(8000..=48000).contains(&spec.sample_rate) {
        return Err(invalid("expected mono/stereo audio at 8–48 kHz"));
    }
    let declared_frames = reader.duration() as usize;
    if declared_frames == 0 || declared_frames as f64 / spec.sample_rate as f64 > MAX_AUDIO_SECONDS
    {
        return Err(invalid(
            "audio must have samples and last at most 300 seconds",
        ));
    }
    let pcm: Vec<i16> = reader
        .samples::<i16>()
        .collect::<std::result::Result<_, _>>()
        .map_err(|e| SpeechError::Audio(e.to_string()))?;
    if pcm.len() != declared_frames * spec.channels as usize {
        return Err(invalid("truncated sample data"));
    }
    let scale = 32768.0 * spec.channels as f32;
    let samples = pcm
        .chunks_exact(spec.channels as usize)
        .map(|frame| frame.iter().map(|x| *x as f32).sum::<f32>() / scale)
        .collect();
    Ok(DecodedAudio {
        sample_rate: spec.sample_rate,
        samples,
    })
}

/// Split on exact sample boundaries; no sample may be discarded or duplicated.
pub fn bounded_segments(samples: &[f32], rate: u32, max_seconds: u32) -> Result<Vec<&[f32]>> {
    let chunk = (rate as usize)
        .checked_mul(max_seconds as usize)
        .filter(|x| *x > 0)
        .ok_or_else(|| SpeechError::Audio("invalid segment size".into()))?;
    Ok(samples.chunks(chunk).collect())
}
