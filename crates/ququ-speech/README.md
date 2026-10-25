# QuQu speech

Rust application code using the official `sherpa-onnx = 1.13.8` bindings and native C++/ONNX Runtime inference. No Python execution or Python installation is used.

The default build uses upstream static native libraries. `--no-default-features` runs the audio/model-contract tests without linking inference; it cannot transcribe. Call synchronous service methods from a blocking desktop worker. Model initialization, switching and recognition are serialized; downloads use a separate lock. Status caches SHA-256 verification by file length and modification time to keep polling cheap.

SenseVoice Small INT8 is the fresh-service default; Paraformer FP32 is selectable. Switching requires verified target models and successful initialization before changing the current selection. Downloads fetch revision-pinned individual files, check exact length and SHA-256, and atomically persist each file. No model archive extraction is performed. Existing PyTorch checkpoints are incompatible and remain untouched.

## Verification and smoke CLI

```powershell
cargo test --manifest-path crates/ququ-speech/Cargo.toml
cargo run --manifest-path crates/ququ-speech/Cargo.toml --example smoke -- <model-root> status
cargo run --manifest-path crates/ququ-speech/Cargo.toml --example smoke -- <model-root> download
cargo run --manifest-path crates/ququ-speech/Cargo.toml --example smoke -- <model-root> transcribe <audio.wav>
# An engine is the fifth argument; use '-' for the unused WAV argument on download/status.
cargo run --manifest-path crates/ququ-speech/Cargo.toml --example smoke -- <model-root> download - paraformer
```

The optional model-backed test reuses verified local files, exercises repeated recognition with punctuation/VAD on and off, checks failed-switch rollback and silence, and releases the runtime:

```powershell
$env:QUQU_SPEECH_MODEL_ROOT = '<user-data>/models/sherpa-onnx'
$env:QUQU_SPEECH_TEST_WAV = '<system-temp>/ququ-sensevoice-smoke-zh.wav'
cargo test --manifest-path crates/ququ-speech/Cargo.toml --test native_smoke -- --ignored
```

SenseVoice downloads 239,233,841 bytes of weights plus tokens/license and Silero VAD. Paraformer FP32 weights are 822,641,426 bytes plus tokens, 294,372,519-byte punctuation weights and shared VAD. Download progress is byte-based. Partial files never count as ready; a failed file can be retried, retaining previously verified completed files.

SenseVoice supports `zh`, `en`, `ja`, `ko`, `yue`, and `auto`. Built-in punctuation is coupled with inverse text normalization through `use_punc`/`use_itn`. Its raw text is the engine output and may already be normalized/punctuated. Recognized text (and AI-optimized text in the desktop app) is converted to Traditional Chinese (Taiwan, OpenCC `s2twp`) when the language is `zh` or `auto`; other languages, and text containing Japanese kana, are preserved verbatim (`src/convert.rs`). Long input uses bounded 30-second recognition segments; enabled Silero VAD supplies speech segments. Paraformer preserves the existing whole-file recognition behavior. Both reject nonempty hotwords explicitly. The pinned Rust result type does not expose the native detected-language field, so automatic language selection returns `language: "auto"` with a warning.

## Artifact provenance and licenses

Manifest sizes and weight SHA-256 values come from the publisher's Hugging Face API LFS metadata; token/license SHA-256 values and Silero weight were independently fetched and hashed on 2026-10-23. All Hugging Face downloads are pinned to full commit IDs in `models.rs`. The Silero release URL is pinned by its expected SHA-256, so upstream replacement is rejected.

- [SenseVoice publisher artifacts](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17)
- [Paraformer publisher artifacts](https://huggingface.co/csukuangfj/sherpa-onnx-paraformer-zh-2024-03-09)
- [Punctuation publisher artifacts](https://huggingface.co/csukuangfj/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12)
- [Silero download documentation](https://k2-fsa.github.io/sherpa/onnx/vad/silero-vad.html)

Sherpa is Apache-2.0 and Silero's code repository is MIT. Model licenses are distinct from code licenses. The SenseVoice artifact's LICENSE points to FunASR licensing; the [official model card](https://huggingface.co/FunAudioLLM/SenseVoiceSmall) declares a custom [model license](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE). Preserve model attribution and the license associated with the exact distributed artifacts. Paraformer/punctuation distribution license metadata must be confirmed before bundling their weights in an installer; runtime downloads come directly from the publisher. This crate does not include model weights.
