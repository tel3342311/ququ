# Local ASR performance baseline

This opt-in benchmark measures the existing native SenseVoice pipeline on one fixed WAV, repeated 30 times after one first recognition. It does not measure accuracy, a representative corpus, UI mode A/B latency, microphone capture, cloud AI, history writes, or paste. These observations cannot establish that Classic or Compact is faster.

## Reproduce

Pause QuQu and avoid concurrent builds before measurement. From the repository root:

```powershell
./scripts/benchmark-local-asr.ps1 -ModelRoot "$env:APPDATA/蛐蛐/models/sherpa-onnx" -Wav "$env:TEMP/ququ-sensevoice-smoke-zh.wav"
```

The script builds the opt-in native example with the repository MSVC static CRT configuration and writes `docs/performance-baseline.json`. This is a debug-profile host calling the prebuilt native inference library, not a release app benchmark. Model files must pass the service's pinned size and SHA-256 integrity checks; no download is performed. WAV parsing validates PCM16 framing/rate/duration, and the report records its SHA-256. Recognition must be nonempty on all runs; recognized text is never emitted.

Model verification is timed separately. `model_initialization_ms` measures first runtime construction after verification; the OS file cache is not flushed, so this is process-cold model initialization, not a cold-disk experiment. `first_recognition_ms` is excluded from the 30 warm samples. Warm samples include WAV decode, cached integrity metadata checks, VAD, recognition and text postprocessing. Nearest-rank p50/p95 are computed from all 30 samples. Real-time factor (RTF) is recognition seconds divided by audio seconds.

## Dictation telemetry

`finishDictation` accepts `{startedAt, now, onMetrics}`. The recording owner captures monotonic `performance.now()` on stop intent (before MediaRecorder finalization and WAV preparation) and passes it as `startedAt`. The `finishRecording` wrapper also reports preparation failures/cancellation. Every completed invocation reports one numeric-only object with `audioPreparationMs`, `asrMs`, `aiMs`, `saveMs`, `pasteMs`, `totalMs`, and `outcome`: 1 success, 2 empty, 3 error, 4 cancellation. `pasteMs` includes clipboard fallback. Total also includes settings reads and callback overhead, so phases need not sum to total. The ASR phase is the host command round trip and may include lazy model initialization; it is not inference-only. Optional AI failure preserves local text and the successful outcome. Observer failures cannot interrupt dictation or replace its error.

Application logging uses `api.log('info', 'dictation-performance ' + JSON.stringify(metrics))`. Metrics never include transcripts, error messages, paths, or credentials. These hooks enable subsequent end-to-end collection; this ASR-only baseline supplies no invented end-to-end measurements.

## Measured result (2026-10-23 18:28 UTC / 2026-10-24 02:28 Taipei)

QuQu was stopped and the native build/test worker had finished before the measured run. Windows x86_64, Intel Core i7-1370P (14 cores / 20 logical processors), 33,999,486,976 bytes RAM; SenseVoice INT8 2024-07-17, sherpa-onnx 1.13.8 CPU provider, four ASR threads, one VAD thread, Chinese, VAD and punctuation enabled. Other system activity was not controlled; this is a single-machine development baseline.

| Measurement | Observed |
| --- | ---: |
| Fixed mono PCM16 audio | 5.592 s at 16 kHz |
| Model integrity verification | 5,451.56 ms |
| Process-cold model initialization (after verification) | 4,913.72 ms |
| First recognition (excluded from warm distribution) | 702.34 ms |
| Warm recognitions | 30 |
| Warm p50 | 606.86 ms |
| Warm p95 | 684.96 ms |
| Warm RTF p50 | 0.10852 |
| Warm RTF p95 | 0.12249 |

The fixed WAV is 178,988 bytes, SHA-256 `b77f1794fe374a0ba1ee1dc458bfaf9349496cbbfc32780c50ba3c5a7ad8e373`. The fixture was already present in the local temporary directory; the repository does not contain or regenerate it. Preserve the same file/hash to compare future runs. [Machine-readable report and all samples](performance-baseline.json).

The observed warm p95 is below this fixture's audio duration. This says only that repeated local recognition of this recording ran faster than real time on this machine. The first-time verification and model initialization are separate substantial costs, and this run is insufficient to infer general accuracy or perceived end-to-end speed.
