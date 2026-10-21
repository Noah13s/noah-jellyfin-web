# Installation and local setup

[Documentation](README.md) · [Development](development.md)

## Prerequisites

- Git; Node 24 and npm 11, matching [package.json](../package.json).
- A reachable Jellyfin Server and a test account.
- For embedded testing, a compatible Seerr host and same-origin `/player/` route.

This checkout does not install a media server or provision accounts. The SDK's
minimum-version guard is one compatibility check; the recorded production
integration uses Server 12.0.0.

## Install and run

```sh
git clone https://github.com/Noah13s/noah-jellyfin-web.git
cd noah-jellyfin-web
npm ci --allow-remote=all --no-audit --no-fund
node scripts/verify-noah-source.mjs
npm start
```

The command-level remote exception allows upstream's integrity-pinned
`classlist.js` tarball. Keep `package-lock.json` intact.

Open the URL printed by webpack and connect to the test server. Client defaults
live in [src/config.json](../src/config.json). Server CORS, HTTPS and authentication
must permit your development origin. A standalone client checks native Jellyfin
behavior; it does not exercise Seerr's iframe bridge.

## Embedded integration

Use a development vhost serving Seerr at `/`, built client files at
`/player/web/`, and Jellyfin API/streams at `/player/`. Different ports mean
different origins. Start playback from Seerr rather than constructing a
token-bearing player URL manually.

Check identity, first frame, pause, resume, seek, subtitles and exit. Use an
isolated fixture and intercept history/report writes in the operator harness.
Keep credentials out of local configuration and diagnostic output.

For production, follow [Deployment](deployment.md); use an immutable release
rather than overwriting the package-managed web directory.
