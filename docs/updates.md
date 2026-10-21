# Upstream and dependency updates

[Documentation](README.md) · [Development](development.md) · [Deployment](deployment.md)

## Stable release versus master

The reviewed upstream is **v12.2**, commit
`61b1f890365ad15138e943e694af723c1d47df2a`. GitHub compares the fork with
development `master`, which can contain work outside the stable release.
Compare the tag when checking stable coverage:

```sh
git remote -v
# Add only if the upstream remote is absent:
git remote add upstream https://github.com/jellyfin/jellyfin-web.git
git fetch upstream tag v12.2
git merge-base --is-ancestor v12.2 HEAD
git rev-list --left-right --count v12.2...HEAD
```

For `tag...HEAD`, the left count is commits present only in the tag history;
zero means the tag is included. The right includes custom and merge commits.
Counts do not measure feature parity. Do not merge development `master` solely
to clear the banner.

## Upgrade procedure

1. Choose a specific stable [upstream release](https://github.com/jellyfin/jellyfin-web/releases).
2. Review server compatibility, SDK minimum/API changes, notes and lockfile.
3. Create a `codex/` branch and merge the tag, preserving ancestry.
4. Inspect Noah hooks in the HTML player, playback manager, details controller,
   router, bootstrap, Cast plugin and bitrate helper.
5. Update `NOAH.md`, manifest pin and source guards deliberately.
6. If HLS.js changes, update its vendored worker and integrity hash together.
   Preserve byte-exact worker data across Windows checkouts.
7. Run local/CI gates and the browser/device matrix. Keep server core patches,
   storage allocation and native TV outside a web-only release.
8. Obtain owner approval for commit/push/merge, then promote the verified artifact
   through coordinated deployment.

A TypeScript build does not establish Safari, mobile, Cast or backend runtime
compatibility. The SDK floor is one check, not the whole decision.

Update the root release line, source map/commands and private release evidence.
Date screenshots/measurements and identify the scenario and client. Label
historical observations so they are not mistaken for current benchmarks.
