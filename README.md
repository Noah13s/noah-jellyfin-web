# Noah Jellyfin Web

The source-built **browser player for Noah Stream**, based on Jellyfin Web.
Seerr provides browsing and watch history; this fork supplies Jellyfin playback
inside Seerr through an explicit, versioned bridge.

| Component | Responsibility |
| --- | --- |
| [Noah Seerr](https://github.com/Noah13s/noah-seerr) | Catalog, requests, profiles, history, Cast controls and player host |
| **This fork** | Browser media engine, capability decisions, subtitles and embedded lifecycle |
| Noah Stream integration repository (private) | Native TV app, server integration and releases |
| Jellyfin Server | Authorized library, PlaybackInfo, streaming and FFmpeg transcoding |

## Start here

| Goal | Guide |
| --- | --- |
| Understand the system and source hooks | [Architecture and bridge](docs/architecture.md) |
| Run a local client | [Installation](docs/installation.md) |
| Change, test and build the player | [Development](docs/development.md) |
| Serve immutable assets and roll back | [Deployment](docs/deployment.md) |
| Upgrade upstream or dependencies | [Updates](docs/updates.md) |
| Diagnose playback or casting | [Troubleshooting](docs/troubleshooting.md) |
| Browse all guides | [Documentation index](docs/README.md) |

## Release line

This fork tracks **stable v12.2**. GitHub's fork banner compares `main` with
upstream's development branch, `master`; its behind count does not indicate
whether the stable tag is included. See [the update guide](docs/updates.md).

- Upstream pin: `61b1f890365ad15138e943e694af723c1d47df2a` (`v12.2`).
- Toolchain: Node 24 and npm 11; dependencies are locked.
- Browser streaming: HTML video and HLS.js 1.6.16, with the matching worker.
- Validated integration: Jellyfin Server 12.0.0, bridge protocol 1.
- Source102 checks covered Edge, Direct Play, HLS, resume and ASS subtitles.
  Physical Safari, mobile and Cast receivers need separate verification.

## Project boundaries and upstream

The separate native TV app uses media_kit/libmpv. Generated bundles are build
outputs; custom behavior lives in source. See [NOAH.md](NOAH.md).

[Jellyfin Web](https://github.com/jellyfin/jellyfin-web) is part of the
[Jellyfin project](https://jellyfin.org). This fork retains its history and
[GPL-2.0-or-later license](LICENSE). Read [CONTRIBUTING.md](CONTRIBUTING.md) and
[support guidance](.github/SUPPORT.md) before proposing upstream changes.
Report Noah-specific issues here with sanitized diagnostics.
