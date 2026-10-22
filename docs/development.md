# Development and verification

[Documentation](README.md) · [Architecture](architecture.md) · [Updates](updates.md)

Start from this fork's `main` and use a `codex/` branch. Preserve upstream
history. [CONTRIBUTING.md](../CONTRIBUTING.md) defines upstream TypeScript, SDK,
React and localization conventions.

## Local gates

After [installation](installation.md), run from the repository root:

```sh
node scripts/verify-noah-source.mjs
npm run build:check
npx vitest run src/plugins/noah src/scripts/browser.test.ts src/utils/image.test.ts
npm run build:production
node scripts/noah-manifest.mjs
```

These match the custom [CI workflow](../.github/workflows/noah-player.yml).
The manifest command requires Git: it writes the current commit, upstream pin
and SHA-256 inventory to `dist/noah-build.json`. Build releases from clean,
committed source. A dirty/untracked checkout emits `candidate: true`, a null
release commit and `baseCommit`; the production deployment gate rejects it.

## Change map

| Change | Start here | Verify |
| --- | --- | --- |
| Capabilities, bitrate, preparation | `src/plugins/noah/policy.js` | Direct Play/HLS, fresh start and resume |
| Passive transfer samples and selected-page renewal | `throughput.js`, `preparation.js` | Server wait versus body transfer, cache rejection, expiry, visibility and late cancellation |
| Text cue index and redraws | `subtitles.js` and HTML player call sites | Silence, overlaps, backward seek, subtitle offset and track replacement |
| Lifecycle or recovery | `src/plugins/noah/embedded.js` | Cancel, exit/reopen, seek and network failure |
| Failure classification and timing | [`playback-recovery.md`](playback-recovery.md), `health.js`, `telemetry.js` | Capacity/auth/subtitle isolation, frame versus clock evidence |
| Host commands | `protocol.js` and Seerr's `playerBridge.ts` | Both endpoints, wrong-frame and late-reply tests |
| Gestures | `src/plugins/noah/gestures.js` | One accumulated seek, direction and timeout |
| Casting | `casting.js` and Seerr controls | Real receiver, sleep/wake and browser reopen |
| HLS upgrade | Lockfile, worker and guard | Exact hash, compatibility and first segment |

Edit maintained source, not generated `dist/*.js`. Keep embedded policies in
explicit hooks rather than overriding global fetch, DOM/media prototypes or
SDK methods.

## Browser regression matrix

| Scenario | Evidence |
| --- | --- |
| Compatible source | Advancing Direct Play frames without an encoder |
| Incompatible source | HLS first frame and startup encoder count |
| Resume and backward/forward seek | Requested/actual position and continuing playback |
| Text/ASS and bitmap subtitles | Timing, on/off and expected stream decision |
| Pause, exit and cancel/reopen | No stale events or another session's cleanup |
| Safari, Android and Cast | Actual device/browser, not only a spoofed user agent |

Record sanitized timings and session-scoped server logs. Never publish cookies,
API keys or signed URLs. Browser checks do not validate the TV's libmpv path.
