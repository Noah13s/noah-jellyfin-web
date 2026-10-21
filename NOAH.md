# Noah Stream source integration

Upstream: Jellyfin Web `v12.0`, commit `0e83c6a724b31f3e9b5a499244331a288c060a4a`.
This fork deliberately preserves the production browser policies during the source migration.

`src/plugins/noah/policy.js` owns explicit profile, source URL, capability and PlaybackInfo caches. The native manager calls it directly; browser APIs and SDK methods are not replaced. `embedded.js` owns local preparation, first-frame events, cancellation, bounded recovery and exact-session cleanup. `protocol.js` exposes version 1 of the same-origin, source-window/frame-identity checked command/event contract.

The source HTML player supplies its video element explicitly. Native router Back exits to Seerr. Existing mobile seek gestures and the persistent Cast transport are bundled from source, retaining their current behavior; the Cast SDK adapter remains isolated to the sender frame. No compiled bundle string replacements or old `player-*.js` scripts are installed.

Unmodified/older Seerr clients without a bridge identity retain ordinary Jellyfin UI playback during rollout. New Seerr clients use protocol commands and never inspect the iframe's DOM.

## Build

Node 24, npm 11. Dependencies and HLS worker are locked. The command-level remote-package exception is needed for upstream's integrity-pinned classlist.js archive.

```
npm ci --allow-remote=all --no-audit --no-fund
node scripts/verify-noah-source.mjs
npm run build:check
npx vitest run src/plugins/noah
npm run build:production
node scripts/noah-manifest.mjs
```

Deploy the generated directory as an immutable release. Keep the original Jellyfin static asset directory available for old hashed chunks and rollback. Build first, switch the active release atomically, and verify authenticated Seerr playback before promotion.

An upstream update is a separate PR: change the pinned base, inspect source-hook diffs, update the matching HLS worker if necessary, then run the browser/media regression matrix. Never apply old compiled-bundle patch installers over this build.
