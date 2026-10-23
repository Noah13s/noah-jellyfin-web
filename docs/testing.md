# Testing the maintained player

Run from the repository root with the Node version in the workflow:

```sh
npm ci --allow-remote=all --no-audit --no-fund
node scripts/verify-noah-source.mjs
node node_modules/eslint/bin/eslint.js --no-inline-config --config scripts/noah-lint.config.mjs 'src/plugins/noah/**/*.js'
npm run build:check
npm test
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

`SonarCloud Code Analysis` is an additional PR check. Automatic analysis does
not run Vitest/Cast tests or import their coverage. A zero/missing coverage value
therefore does not measure this suite; the test artifacts above are the execution
evidence. See [Sonar's coverage documentation](https://docs.sonarsource.com/sonarqube-cloud/analyzing-source-code/test-coverage/overview/).
Keep this check and `check-and-build` green for the same commit before merging.
PR updates run once, instead of starting duplicate branch-push builds. Use manual
workflow dispatch when testing a branch without a pull request.
