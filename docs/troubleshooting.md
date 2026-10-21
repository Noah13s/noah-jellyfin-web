# Troubleshooting

[Documentation](README.md) · [Architecture](architecture.md) · [Deployment](deployment.md)

Record the deployed `noah-build.json` source, Seerr image, server version,
browser/device, media/subtitle codec and failure phase. Use sanitized evidence.

| Symptom | Inspect first | Next action |
| --- | --- | --- |
| Loading with no PlaybackInfo/stream request | Seerr handoff and bridge events | Check origin, frame identity, authenticated preparation and cancellation |
| Linking error after playback previously worked | Auth route status and linked user ID | Distinguish missing mapping, revoked token and outage before clearing data |
| First segment slow | PlaybackInfo, encoder start, segment generation and transfer | Correlate browser/server timings to locate the delay |
| Two startup encoders or bitrate probes | Initial and subsequent policy decisions | Preserve one initial budget; inspect source hooks |
| Subtitle change fails or audio changes | Track indices and selected streams | Test off/on and seek afterward; inspect ordered replies |
| ASS captions too large or persistent | Codec and text-conversion path | Check cue boundaries, language and styling on the actual client |
| TV plays but Cast control disconnects | Seerr sender and Cast session | Reproduce browser close and sleep/wake with a real receiver |
| Missing chunks after update | Active alias, archive and cache headers | Restore previous alias/release pair and retain old files |
| HLS worker ReferenceError | Library version and worker hash | Restore matching worker and rebuild |

## Useful evidence

- Bridge events: `ready`, `prepared`, `firstFrame`, `position`, `state`,
  `recovering`, `error`, `close`; command IDs and replies.
- Browser: request timestamps/status, video dimensions, readyState, actual
  currentTime advancement and dropped frames where supported.
- Server: PlaybackInfo, encoding/session IDs, FFmpeg/first-segment timing,
  storage pressure and transfer timings.

Observe sessions without stopping another viewer's encoder. A Cast receiver can
continue after the sender loses its control object. A desktop user-agent spoof
does not reproduce Mac/iPhone playback; headless Edge does not prove phone
sleep/wake behavior.

## Safe reporting

Strip cookies, Authorization headers, API keys and query tokens from logs and
screenshots. Avoid raw Playwright error objects, whose request diagnostics may
contain credentials. Keep actual account/server details in private records.
