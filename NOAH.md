# Noah Stream source integration

Upstream: Jellyfin Web **v12.2**, commit
`61b1f890365ad15138e943e694af723c1d47df2a`. Bridge protocol: **1**.

The integration lives in `src/plugins/noah/` and explicit native Jellyfin call
sites. Seerr owns the host UI; the player owns startup and its video element.
Hosts without a bridge identity retain ordinary Jellyfin startup.

- [Architecture and protocol](docs/architecture.md)
- [Installation](docs/installation.md)
- [Development and CI](docs/development.md)
- [Deployment and rollback](docs/deployment.md)
- [Stable upstream updates](docs/updates.md)
- [Troubleshooting](docs/troubleshooting.md)

The separate native TV app uses media_kit/libmpv. Legacy compiled-bundle patch
installers must not be applied over this source build. The HLS 1.6.16 worker is
locked and checked byte-for-byte.
