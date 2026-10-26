# Connection boundaries and coverage reporting

Local implementation batch, 26 October 2026; starting Sonar snapshot: 259 open
findings. See the adjacent finding ledger for targets requiring fresh analysis.
No online issue dispositions have been changed.

## Server discovery

Public discovery accepts absolute HTTP(S) server URLs without embedded
credentials, query strings, fragments or control characters. It preserves
configured cross-origin servers, reverse-proxy prefixes, server ordering and
unfinished setup-wizard preference. Trailing slashes are normalized and duplicate
candidates are probed only once. The configured server list is not mutated.

Discovery sends no browser cookies and does not follow redirects to another
endpoint. Each candidate, including response-body parsing, has a ten-second
deadline. A failed candidate cannot prevent another server from being selected.
Modern browsers also abort the fetch; older browsers without AbortController
still settle the discovery promise. Only the optional API guard has a narrowly
documented compatibility-lint exception, covered by a legacy-browser regression.
An already-authenticated API client's address bypasses public discovery as before.

Connection-manager failures now carry Error objects. Tests preserve the existing
HTTPS→HTTP fallback, explicit-protocol behavior and resolved Unavailable state.
Intentional user-cancellation contracts in playback/dialogs remain unchanged;
turning every quiet cancellation into a visible error is not a safe bulk fix.

## Coverage is measured by the test runners

Vitest V8 emits LCOV and a JSON summary for the full source tree, including
unimported files at zero. The independent Node Cast contracts also emit LCOV.
Their VM source receives its real filename so actual execution is attributed to
`casting.js`. Vitest retains that separate report instead of clearing it.
Both reports are imported by the prepared scanner, avoiding a false zero for
casting merely because its tests use a different runner.

The local browser-suite run measured about 1.97% line coverage across the full
upstream source tree, with 47.7% for maintained Noah modules before adding the
separate Cast report. The 53 Cast contracts measure 96.65% line coverage for
their adapter. These scopes must not be presented as one interchangeable
percentage. Coverage demonstrates executed code, not absence of defects or a
successful physical TV/network test.

Automatic Sonar analysis cannot import these reports. The new `sonar` CI job is
disabled until repository variable `SONAR_CI_ENABLED=true`, a project-scoped
`SONAR_TOKEN` secret is configured and Automatic Analysis is disabled in the
project. Follow the shared [CI migration instructions](https://github.com/Noah13s/noah-seerr/blob/main/docs/noah/sonar-runtime-security.md#activate-ci-analysis-after-reviewing-and-merging-the-workflow).
The scanner uses full history, requires nonempty reports, skips untrusted fork
PRs and waits for the quality gate. No cloud configuration was changed locally.

## Validation and remaining work

The complete 231-test coverage-enabled browser suite, 53 Cast contracts, focused new
discovery/connection tests, full TypeScript and changed-file ESLint passed.
Production webpack passed locally with bounded workers and two existing
bundle-size warnings, after the separate full TypeScript check. Normal hosted
build/typechecking gates remain unchanged. Fresh
hosted checks/Sonar analysis remain required on an approved commit. Nothing was
deployed or published from this batch.

Remaining work includes playback/dialog rejection semantics, heading
accessibility, intentional RTL-control review and low-impact numeric API style.
