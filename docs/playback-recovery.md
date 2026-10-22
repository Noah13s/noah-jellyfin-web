# Classified recovery and measurement

[Architecture](architecture.md) · [Development](development.md)

The embedded source player owns recovery through explicit hooks. Ordinary
Jellyfin/Cast players retain upstream error handling; there are no global fetch,
media-element prototype or SDK overrides.

| Failure | Embedded action |
| --- | --- |
| Subtitle/ASS renderer only | Keep video running |
| Network/server transport | Reopen current stream/session/quality first |
| Missing/expired HLS segment (404/410) | Refresh metadata at the checkpoint, same profile |
| Decoder | Same stream first, at most one compatibility conversion |
| Authentication (401/403) | End safely; authenticated Seerr parent owns renewal |
| Storage/capacity (507 or explicit storage rejection) | End safely; no additional encoder |

Two same-stream attempts are allowed, ten seconds apart; healthy progress for a
minute restores the budget. Concurrent errors share one recovery. Commands wait
for recovery, while Stop invalidates the generation immediately. A late open or
recovery cannot restart an exited player. Preserve position, pause state, selected
audio and subtitles, including Off. Same-stream recovery avoids PlaybackInfo and
does not stop the existing encoder. A timestamp-shifted progressive conversion
instead requires fresh metadata.

When a replacement encoder is necessary, stop only the local reader first,
release its exact device/PlaySessionId with a five-second deadline, then open the
replacement. Keep this inside the stream-change state; the full playback-manager
Stop represents a user exit and would close the embedded player. A failed release
or cancelled owner must not allocate a second encoder. This avoids overlapping
GPU allocations during recovery; other GPU workloads can still exhaust capacity.

The 12-second watchdog excludes hidden, paused, seeking/track-change and ended
playback. It distinguishes buffer starvation from probable decoder failure.
Where available, one pending `requestVideoFrameCallback`, sampled at watchdog
cadence, also detects missing presentation while the clock advances. Browsers
without that API retain clock/buffer checks; a static picture alone is not used
to infer failure. The 30-second open deadline remains separately bounded.

## Measurements

On an authenticated same-origin embedded frame:

```js
window.__seerrPlaybackMetrics()
```

This returns a copy with at most 128 events, 24 metric names and 64 observations
per metric. It contains sanitized fixed labels/numbers, not media URLs, raw
exceptions, account IDs or tokens. Metrics are owner-local, not persistent
cross-user analytics. P50/P95 describe retained observations, not a population
benchmark from one playback.

- `playIntent` and `presentedFrame` measure embedded play intent to actual browser
  video-frame callback. On older browsers the weaker signal is named
  `playingEvent`, never presented-frame evidence.
- Command `*Ack`, seek settlement and `seekFrame` are distinct. Paused seek frame
  evidence may arrive only after resume.
- `replacementFrame` measures replacement-source presentation separately from
  initial play intent; do not mix recovery latency into initial-start percentiles.
- Buffering intervals and recovery classifications explain interruptions.
- `segmentHeaders` and `segmentBody` separate header wait and first-to-last-byte
  body duration. Generation and inter-chunk pauses can affect either; these are
  observed streaming delivery measurements, not a pure network speed test.
- Source/module preparation can precede Play. Trace elapsed time and play-intent
  latency use different anchors; do not confuse them.

No startup speed probe is added, and recovery does not reconsider the bitrate
for an interrupted transport. Existing retained-throughput and early encoder
stability policies remain. The broad Safari compatibility policy is unchanged.

## Verification boundary

Unit/integration fixtures cover classification, bounds, stale owner cancellation,
same-stream network recovery, capacity errors, metadata refresh and preserving
audio/subtitle Off. Build and protocol checks are separate from real-client
verification. Physical Safari, phone sleep/wake and Chromecast remain distinct
gates; Windows Chromium or a spoofed Apple user agent cannot establish MacBook
performance. Deploy a reviewed committed artifact through the existing release
procedure; never overwrite generated live bundles.

### Candidate verification, 22 October 2026

- 39 unit/integration tests passed, TypeScript check and explicit-hook/HLS-worker
  guards passed. Native companion changes passed 154 Flutter tests; build 1046
  was installed and exercised on the physical TCL. These are separate engines.
- A private Edge Chromium preview used the real Jellyfin server and an isolated
  non-admin fixture. Candidate assets were served locally; the public web release
  was unchanged. Seerr watch-history and Jellyfin progress writes were intercepted,
  and the temporary fixture session/device was removed afterward.
- Injected one HTTP 410 media-fragment response during playback. Recovery kept
  the player open and the same profile, released the old owned encoder before its
  replacement and restored the queued seek/resume. Video resumed at 120.05 s,
  unpaused, then advanced to 127.07 s. Subtitle on/off, another skip and exit
  passed. There were zero synthetic bitrate probes and one startup encoder.
- This test caught and fixed a real overlap: the old/new GPU decoder allocations
  previously coexisted, and Jellyfin FFmpeg reported CUDA out-of-memory (exit 218).
  No unrelated GPU process was stopped to make the test pass.
- A separate Grand Blue S1E6 AV1/Opus/ASS case passed with Direct Play and zero
  startup encoders/probes, including pause, seek, resume, captions and exit. A
  high-bitrate Whiplash HEVC case also passed using HLS; it was not Direct Play.
- The measured replacement-frame interval in that preview was 2.63 s, one sample,
  not P95. Unminified preview startup is not a production startup benchmark or a
  MacBook performance result. Real-media HLS cache A/B startup improvement remains
  unquantified; the cache is native-only and browsers already stream HLS bodies.

Keep production deployment gated on a committed, reviewed build. The manifest
generator now marks a dirty/untracked source tree as an uncommitted candidate;
the existing deployment gate rejects that artifact for production.
