# Rust speech engine migration

Status: approved for implementation by the user's “start implement” instruction; native service implemented and model-backed validation in progress.

Platform order confirmed by the user in Lavish: Windows first, then macOS. Native speech packaging and model-backed validation follow that order; Linux is outside the initial delivery milestones.

## Intent and scope

Replace `funasr_server.py`, `download_models.py`, and the embedded Python runtime with a Rust speech service. Keep local Chinese dictation, optional punctuation, model readiness and downloads, progress reporting, and transcription metadata. Add SenseVoice as explicitly requested by the user, alongside selectable Paraformer. Integrate with the Tauri desktop migration without changing React recording behavior.

The recommended implementation is Rust application code using the official `sherpa-onnx` Rust crate. Its inference implementation uses native C/C++ and ONNX Runtime. It removes Python from the installed app; it is not an entirely Rust inference stack. The user requested Rust, but has not specifically required every dependency to be implemented in Rust.

## Existing behavior verified in this repository

- ASR: `damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch`, revision `v2.0.4`, CPU.
- VAD: FSMN Chinese 16 kHz model at the same revision.
- Punctuation: CT-Transformer vocab272727 at the same revision.
- VAD currently executes, but its segments are discarded; ASR receives the full audio file. Segmenting before recognition would change existing behavior.
- Python protocol is one JSON object per line. Startup emits an initialization result; commands are `transcribe`, `status`, `stats`, `cleanup`, and `exit`. Transcription accepts `audio_path` and an `options` object.
- Transcription returns `success`, `text`, `raw_text`, `confidence`, `duration`, `language`, and `model_type`. Confidence is normally zero with the current implementation.
- Download events contain `stage`, `model`, `progress`, `overall_progress`, `completed`, `total`, and optional `error`; completion returns per-model results.
- The renderer produces 16-bit PCM WAV using an AudioContext requesting 16 kHz. Backend input must still validate the actual WAV format and channel count.
- Hotwords are passed through the Python protocol, but the current React code does not expose a hotword control. Existing ModelScope checkpoints must remain untouched; they are not ONNX models.

## Recommended model route and its limits

Use pinned, supported ONNX model bundles rather than attempting to load `.pt` files directly. Revised recommendation: SenseVoiceSmall INT8 is the proposed default for new installations, with Paraformer as a selectable alternative. This default is an implementation recommendation, not a user choice already approved; it is based on its supported Rust path, smaller download, five-language support, and built-in punctuation, not a measured accuracy or latency advantage over this app's current engine. Preserve an existing explicit model selection when migrating settings. Proposed catalog:

| Role | Proposed artifact | Approximate installed weight size | Compatibility |
| --- | --- | --- | --- |
| ASR, proposed default | `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17/model.int8.onnx` plus `tokens.txt` | 228 MB weight; 308 KB tokens | SenseVoiceSmall; different model from existing Paraformer |
| ASR, optional | `sherpa-onnx-paraformer-zh-2024-03-09/model.onnx` plus `tokens.txt` | 785 MB weight | Chinese/English Paraformer; different source checkpoint/vocabulary from current vocab8404 model |
| VAD | k2-fsa `silero_vad.onnx` | 629 KB | Replaces FSMN; preserve Paraformer whole-file behavior, segment long SenseVoice recordings |
| Punctuation, Paraformer dependency | `sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12/model.onnx` | 281 MB | Same model family; exact revision/output parity unproven; not required by SenseVoice |

Sizes above are upstream displayed weight sizes, not verified download lengths. The Paraformer release archive includes FP32 and INT8 variants; downloading that archive may therefore transfer more than the selected installed weights. Resolve exact asset lengths, hashes, and licenses when pinning the manifest. INT8 Paraformer (217 MB) and punctuation (72 MB) are possible later variants, with separate quality validation.

ASR and punctuation archives come from k2-fsa's `sherpa-onnx` GitHub release tags `asr-models` and `punctuation-models`; Silero comes from its documented upstream model link. SenseVoice's dedicated INT8 archive avoids downloading its optional 894 MB FP32 weight. Store versioned artifacts in the application's user data directory under `models/sherpa-onnx/`. Do not reinterpret the old ModelScope cache as ready.

The public preconverted ASR model is derived from a vocab8358 TensorFlow checkpoint, whereas this app uses vocab8404 PyTorch. Thus the recommendation preserves the local Chinese speech feature, not identical recognized text. A strict checkpoint-parity route requires an offline export of the exact pinned original checkpoint and a verified compatible frontend/tokenizer/model layout. That export may use Python on a maintainer machine, while shipped inference remains Python-free. Do not promise compatibility before an export and recorded-audio comparison succeed.

Sherpa's documented contextual hotword route does not apply to these Paraformer or SenseVoice configurations. Reject a nonempty unsupported hotword option with an explicit capability error; never silently claim it was applied. If preserving working Paraformer hotword biasing is mandatory, this recommendation needs a different native runtime or a larger port.

## SenseVoice behavior and settings

The official Rust API exposes `OfflineSenseVoiceModelConfig { model, language, use_itn }` through the same offline recognizer. Set `language` to `zh` by default to retain the Chinese dictation focus; settings may choose `auto`, `zh`, `yue`, `en`, `ja`, or `ko`. The released Small checkpoint supports Mandarin, Cantonese, English, Japanese, and Korean; do not advertise the research model's broader language claims.

Use built-in punctuation with `use_itn=true`; do not run CT-Transformer afterward. `use_itn` also changes inverse text normalization, so disabling punctuation is a coupled normalization choice. Surface it as “Punctuation and text normalization” for SenseVoice and map legacy `use_punc` to it unless a new explicit setting exists. Preserve the engine's decoded text in `raw_text`; for SenseVoice it may already include punctuation/normalization. Do not claim it is an unpunctuated second decode. AI-processed text remains separate.

SenseVoice is offline ASR. For long recordings, add bounded segmentation with Silero and a maximum 30-second recognition segment, unlike the existing Paraformer VAD no-op. Preserve segment order, use deterministic bounded fallback chunks when VAD is disabled, and retain timing offsets. This is an intentional behavior change needed to bound memory; verify boundary speech and silence with recorded audio. Short clips can be recognized directly. Microphone simulated streaming is not true streaming model inference.

Current upstream native conversion exposes token timestamps and language/emotion/event metadata. Treat timestamps as approximate optional metadata, not guaranteed word-level forced alignment; validate against the pinned release because master implementation is not proof of that release's capability. The existing UI need not expose new timestamps or emotion/event tags. Preserve supported language metadata instead of hardcoding `zh-CN` for every SenseVoice result, and keep decoded text free of control tags. Hotword biasing remains unsupported.

Add persisted `speech_engine` (`sensevoice` or `paraformer`), `speech_language`, and SenseVoice normalization choice. Extend the available/current/switch-model desktop commands and model status records with engine ID, variant, languages, and capability flags. Download only the selected engine's dependency set; SenseVoice readiness requires its model/tokens and selected VAD, not the optional Paraformer punctuation model. Add engine ID/variant to progress events while retaining existing fields. Switch atomically between jobs after successful target initialization, release inactive model memory, and preserve the previous usable selection if initialization fails. Never silently substitute another engine after a failure.

## Components and contracts

Create an independent `ququ-speech` Rust crate with audio validation, model manifest/download management, inference, lifecycle state, and protocol types. The parent desktop implementer chooses workspace placement to avoid conflicting Cargo files. Expose Rust methods to Tauri; retain an optional JSON-lines binary adapter for isolated smoke tests and compatibility. Keep the app's command/event names stable through the desktop bridge.

Run inference on a dedicated worker owning the native model handles. Serialize recognition jobs, keep UI/status operations responsive, and avoid assuming native objects can be used concurrently. State is `missing`, `downloading`, `initializing`, `ready`, or `error`; optional capability information identifies ASR/VAD/punctuation/hotwords. Missing files must not trigger an implicit model download. Initialization failures must remain visible and retryable.

Validate WAV headers and bounds, decode PCM16, mix channels to mono, and use the recognizer's documented resampling path or a verified Rust resampler. Derive duration from decoded sample count. For Paraformer, preserve raw text separately from punctuated text and return raw text with a warning if punctuation fails. SenseVoice uses the decoded-text semantics described above. Keep `confidence: 0.0` for compatibility and report `model_type: "onnx"`. Keep stats and cleanup behavior; do not pretend garbage collection exists in Rust.

Downloads run per-model with bounded concurrency, stream byte progress, verify pinned SHA-256, unpack only permitted paths/files, and atomically mark completion after validation. Partial or corrupt files never count as ready. Use JSON structured application logging and the dedicated speech log destination; JSON protocol stdout contains only protocol objects. A binary adapter must buffer split lines, bound message size, and serialize commands so replies cannot be misassociated.

## Packaging and licenses

Pin a released crate and matching native libraries in Cargo.lock; do not depend on Git master. Upstream Rust build logic currently defines native library archives for Windows x64/ARM64, macOS x64/ARM64, and Linux x64/ARM64. This is source evidence of target mapping, not proof every chosen release archive exists or every app package runs. Start validation on Windows x64, then verify each supported target in CI or on its host. Prefer static native linking where supported; bundle and verify shared libraries when required.

Sherpa-onnx is Apache-2.0 and Silero's repository is MIT. Model artifact permissions are separate: verify and retain the ASR/punctuation model cards/licenses and native dependency notices before redistributing a pinned bundle. SenseVoice code's repository license is MIT, but its official Small model card declares `license: other` and points to the FunASR model license. The current linked agreement is version 1.1; retain provenance, attribution, model names, and the license applicable to the exact pinned artifact. The ONNX archive's listed LICENSE was not fetched during this inspection, so do not label the model MIT or assume identical licensing from code. Exact Paraformer/punctuation artifact license/revision metadata also remains unverified.

## Acceptance and handoff

1. Pure Rust unit tests cover protocol framing, state transitions, WAV validation, missing/corrupt models, download interruption, hash mismatch, and invalid archive paths.
2. Model-backed tests exercise both engine selections, Chinese speech, silence, punctuation on/off, repeated requests, shutdown, and non-ASCII file paths without Python installed. Add SenseVoice language selection/auto-detection, normalization, long-audio segment joins, failed-switch rollback, and readiness without CT-Transformer downloaded.
3. Compare a checked-in or explicitly obtained recorded-audio corpus against the old backend; report differences rather than claiming exact parity. No suitable corpus was found during this inspection.
4. Verify desktop command/event shapes and progress cancellation/retry with the parent workstream.
5. Remove Python packaging and obsolete install UI only after native inference and a packaged-app smoke test succeed. Changes to Electron/React/build files belong to the parent workstream.

Current workstation PATH lacks Cargo and pnpm according to the parent inspection, so compilation and real inference have not been validated. No model assets have been downloaded.

## Primary evidence

- [Official Rust SenseVoice example](https://github.com/k2-fsa/sherpa-onnx/blob/master/rust-api-examples/examples/sense_voice.rs)
- [SenseVoice ONNX artifacts, sizes, languages, and punctuation](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)
- [SenseVoice released-checkpoint scope and long-audio guidance](https://github.com/FunAudioLLM/SenseVoice/blob/main/README.md)
- [SenseVoice native result metadata/timestamps](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/csrc/offline-recognizer-sense-voice-impl.h)
- [Official SenseVoiceSmall model-card license metadata](https://huggingface.co/FunAudioLLM/SenseVoiceSmall/blob/main/README.md), [linked model license](https://github.com/modelscope/FunASR/blob/main/MODEL_LICENSE), [code license](https://github.com/FunAudioLLM/SenseVoice/blob/main/LICENSE)
- [Official Rust Paraformer example](https://github.com/k2-fsa/sherpa-onnx/blob/master/rust-api-examples/examples/paraformer.rs)
- [Official Paraformer model provenance, sizes, and downloads](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/offline-paraformer/paraformer-models.html)
- [Official punctuation model provenance and downloads](https://k2-fsa.github.io/sherpa/onnx/punctuation/pretrained_models.html)
- [Official Rust punctuation example](https://github.com/k2-fsa/sherpa-onnx/blob/master/rust-api-examples/examples/offline_punctuation.rs)
- [Official Rust VAD configuration](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/rust/sherpa-onnx/src/vad.rs)
- [Official Silero model sizes](https://k2-fsa.github.io/sherpa/onnx/vad/silero-vad.html)
- [Official hotword limitations](https://k2-fsa.github.io/sherpa/onnx/hotwords/index.html)
- [Official Rust native library build logic](https://github.com/k2-fsa/sherpa-onnx/blob/master/sherpa-onnx/rust/sherpa-onnx-sys/build.rs)
- [Sherpa license](https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE), [Silero license](https://github.com/snakers4/silero-vad/blob/master/LICENSE)
