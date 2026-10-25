# Declarative control names and safer installs

## Batch two: local source, 25 October 2026

The starting snapshot has 434 open findings. This batch targets 170 recorded
control-label findings, the document-language finding and four dependency
lifecycle-script findings. Counts are a source-change ledger, not confirmed
Sonar closures until the approved revision is analyzed.

### Accessible before custom-element upgrade

Jellyfin's input/select/textarea elements generate visible labels at runtime.
Templates now also supply the matching localized `aria-label`, so controls have
names before upgrade. `setControlLabel` keeps accessible names synchronized
when a controller changes the visible label, including context-dependent
metadata fields. Existing generated labels and custom-element IDs remain.

Native upload controls, subtitle offset, playback position and volume have
explicit localized names. Standard English fallback document language is
explicit; the existing globalization layer sets the actual user's language.
The new volume label is translated in English and French, with the normal
fallback for other locales.

A structural diff audit confirms all 34 changed HTML files differ only in
accessible-name/document-language attributes. Existing translation values are
unchanged. CSS, streaming choices, casting and playback decisions are unchanged.

### Dependency installation

All four affected workflows install from the existing lockfile with
`npm ci --ignore-scripts`; no dependency versions changed. This prevents
dependency lifecycle scripts from executing during installation. The build and
test commands still run explicitly as reviewed workflow steps. A clean local
install with scripts disabled completed successfully.

### Verification

- 214 Vitest tests and 53 maintained Node contracts passed.
- Final eight accessible-name regressions passed after switching their static
  fixture loading to Node file reads supported by both ESLint and Vitest.
- Full TypeScript and changed-file ESLint passed.
- Production webpack passed with two existing bundle-size warnings, using
  bounded local workers and a separately completed full typecheck. Normal CI
  build remains required before merge.

No tests, rules or source directories were excluded for this batch. No player
release was deployed. Remaining findings include intentional RTL-string
reviews, rejected-promise semantics, heading accessibility and numeric API
modernization; these need case-specific review rather than bulk suppression.
