# Testing the maintained player

Run from the repository root with the Node version in the workflow:

```sh
npm ci --ignore-scripts --allow-remote=all --no-audit --no-fund
node scripts/verify-noah-source.mjs
node node_modules/eslint/bin/eslint.js --no-inline-config --config scripts/noah-lint.config.mjs 'src/plugins/noah/**/*.js'
npm run build:check
npm test -- --coverage
node --test test/contracts/*.cjs
npm run build:production
```

`check-and-build` runs **all** Vitest files, including upstream tests. It also
runs the 53 current-source Cast contract cases. JUnit and the built assets are
retained as GitHub artifacts for 14 days. A failed assertion fails the check.

## Test ownership

| Layer | What it proves | Boundary |
| --- | --- | --- |
| Vitest policy/DOM tests | Recovery decisions, resume, subtitles, bridge and UI behavior | Simulated DOM; no physical decoder |
| Cast contract tests | Receiver ownership, ACK/error paths, cold rejoin, track reload and lifecycle | Fake Google SDK; not receiver radio/network behavior |
| Source verification and safety lint | Integration hooks, worker integrity, no dynamic code execution | Not a full security audit |
| Production build | Shipping module graph and type compatibility | Does not play a video |

The Cast cases were migrated from the integration repository's legacy bundle
tests. Fixture pagehide events now model trusted document events, and the cold
restore fixture sets `isInitialized` on the **native transport**, as the real
plugin does. No production recovery condition was relaxed to make them pass.

The old resume bundle harness is an archived deployment test, not a gate for
this source player. Current resume/recovery regressions belong beside
`src/plugins/noah` and the HTML player. New tests must import the maintained
source, not copied deployment bundles.

Native decoder/emulator and disposable Jellyfin storage/service checks are owned
by the private Noah Stream integration repository. Physical Cast, Safari, HDR,
Bluetooth and TCL frame pacing still require targeted device validation.

## SonarQube Cloud

CI analysis is enabled on this fork; Automatic Analysis is disabled. The `sonar`
job imports browser/Node LCOV and Python Cobertura XML after the build. See
[coverage scope and migration](sonar-runtime-security.md) for setup/recovery.
Reports are required and tied to the current commit. A successful import does
not imply that the unchanged 80% new-code coverage requirement passes.
Keep `sonar` and `check-and-build` green for the same commit before merging.
PR updates run once, instead of starting duplicate branch-push builds. Use manual
workflow dispatch when testing a branch without a pull request.

Python audit tests run in a disposable venv using the hash-locked
`scripts/requirements-test.txt` reporter. `.coveragerc` retains unexecuted Python
tools as uncovered rather than counting only imported files. The report is
`coverage/python.xml`; Vitest preserves it while generating JavaScript coverage.
The translation audit command test exercises report output in a temporary fake
checkout. It does not modify this checkout's translations.
