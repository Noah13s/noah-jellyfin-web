# Sonar remediation

## Priority one: 25 October 2026

This batch addresses nine BLOCKER/CRITICAL findings from the initial 443-issue
open backlog. Source fixes await fresh Sonar analysis of the approved commit.
No rule or source directory was excluded to obtain a green result.

### Changes

- Replace the unused-translation shell/grep pipeline with pure Python scanning.
  Keys are escaped literal data, translation dictionaries are excluded from
  references, and `.js`, `.jsx`, `.ts`, `.tsx` and `.html` sources are considered.
  Dynamic translation keys still require manual review before removal.
- Keep the current-video binding private, expose its getter, and initialize the
  exported query client as a constant. Query error callbacks execute after its
  initialization.
- Extract inclusive local-calendar guide iteration with explicit cursor
  advancement. It preserves calendar dates across daylight-saving changes. The
  original mutation worked at runtime, but was opaque to the loop analyzer.
- Remove duplicate `items` IDs and use controller selectors scoped to their tab.
  The genres wrapper remains distinct from its nested item containers.

### Verification

| Check | Local result / remaining gate |
| --- | --- |
| Vitest suite | 206 passed, including calendar and independent-tab regressions |
| Maintained Node contracts | 53 passed |
| Python scanner security/discovery tests | 3 passed; also added to CI |
| Full TypeScript; changed-file and Noah plugin lint | Passed |
| Production webpack bundle | Passed with two existing size warnings |
| Normal CI production build and fresh Sonar analysis | Pending approved Git update |

The local production build retained production minification but used one
minifier worker and two parallel compilation tasks to bound RAM. The duplicate
type-check plugin was omitted in that local build because the separate full
typecheck had already passed. CI still uses the normal build. No new deployed
player assets or live playback verification are claimed by this source batch.

### Finding ledger

| Finding | Rule / source at initial scan | Disposition |
| --- | --- | --- |
| `AaFoJZJzOZDKsE3tmJmf` | `javascript:S6861`; `src/plugins/noah/policy.js:22` | **Source fix pending analysis.** Private video binding and getter. |
| `AaFoJZbgOZDKsE3tmJrY` | `typescript:S6861`; `src/utils/query/queryClient.ts:18` | **Source fix pending analysis.** Constant client initialization. |
| `AaFoJZdgOZDKsE3tmJro` | `pythonsecurity:S2076`; `scripts/unused.py:20` | **Source fix pending analysis.** Pure Python literal scanner; no shell execution. |
| `AaFoJZRJOZDKsE3tmJoA` | `javascript:S2189`; `src/components/guide/guide.js:855` | **Source fix pending analysis.** Explicit calendar cursor advancement and DST tests. |
| `AaFoJZRJOZDKsE3tmJoB` | `javascript:S2189`; `src/components/guide/guide.js:855` | **Source fix pending analysis.** Explicit calendar cursor advancement and DST tests. |
| `AaFoJZEZOZDKsE3tmJlu` | `Web:S7930`; `src/apps/legacy/controllers/music/music.html:108` | **Source fix pending analysis.** Unique IDs and tab-scoped selectors with DOM regressions. |
| `AaFoJZEZOZDKsE3tmJlv` | `Web:S7930`; `src/apps/legacy/controllers/music/music.html:115` | **Source fix pending analysis.** Unique IDs and tab-scoped selectors with DOM regressions. |
| `AaFoJZEPOZDKsE3tmJlk` | `Web:S7930`; `src/apps/legacy/controllers/shows/tvrecommended.html:57` | **Source fix pending analysis.** Unique IDs and tab-scoped selectors with DOM regressions. |
| `AaFoJZHqOZDKsE3tmJmE` | `Web:S7930`; `src/apps/legacy/controllers/livetv.html:94` | **Source fix pending analysis.** Unique IDs and tab-scoped selectors with DOM regressions. |

## Next priorities

1. Analyze the approved commit and reconcile every ledger entry with its new
   location/status; do not assume that moving code resolves a finding.
2. Address remaining security and reliability findings by impact and reachability,
   including build/install trust boundaries. Review false positives individually
   with data-flow evidence rather than marking whole rule groups safe.
3. Address remaining correctness, accessibility and maintainability debt. Handle
   asynchronous errors explicitly instead of hiding promise warnings with `void`.

A green new-code quality gate does not mean the overall backlog is empty. Update
this record after CI with exact commit/check references and distinguish local,
emulated and physical-device evidence.
