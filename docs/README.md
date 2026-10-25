# Player documentation

[Project overview](../README.md) · [Source integration](../NOAH.md)

1. [Architecture](architecture.md): source map, ownership and bridge.
2. [Installation](installation.md): local client and integration requirements.
3. [Development](development.md): tests, build and manifest.
4. [Deployment](deployment.md): immutable assets, release gates and rollback.
5. [Updates](updates.md): stable merges and HLS worker integrity.
6. [Troubleshooting](troubleshooting.md): symptoms, evidence and device limits.
7. [Playback recovery and measurements](playback-recovery.md): classified errors, encoder handoff and frame evidence.
8. [Testing](testing.md): complete CI gates, Cast contracts and verification boundaries.
9. [Sonar remediation](sonar-remediation.md): priority-one changes, finding ledger and verification limits.
10. [Sonar batch two](sonar-remediation-2.md): accessible control names and script-disabled installs.

## Authoritative records

Source and lockfiles define behavior and dependencies. `NOAH.md` records the
reviewed upstream pin; CI defines the build gate. A deployed `noah-build.json`
identifies exact committed source and asset hashes. Repository `main` may also
contain later documentation commits.

The private integration release manifest records the paired Seerr image, backend
baseline, deployment time and rollback directory. A default-branch banner or
upstream release badge does not identify the live build.

## Maintaining documentation

Update the guide when changing a command, hook, protocol, dependency, release
gate or recovery path. Link to source rather than copying modules. Keep diagrams
consistent with code. Screenshots must omit credentials, accounts and private
library details. Date measurements and identify hardware/browser; one sample
does not establish general performance.

Diagrams include SVG images and collapsible Mermaid definitions. Open an image
for full-size labels. Update the definition first, then regenerate its SVG with
Mermaid 12.2.0, `htmlLabels: false` and a white background. Keep filenames stable,
check rendering and links, and omit executable/external SVG content.
