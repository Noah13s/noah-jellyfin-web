# Archived upstream workflows

These upstream workflow definitions are retained for comparison outside
`.github/workflows`, so GitHub Actions does not run them. They include upstream
release, deployment, automation, reusable checks and security workflows.
Do not restore them without reviewing triggers, permissions, secrets, and
reusable workflow references for this fork.

The active fork workflow is [`noah-player.yml`](../workflows/noah-player.yml).
It runs source checks, tests, coverage and the production build, followed by
Sonar analysis when configured. This archive does not itself provide upstream
CodeQL scanning or deployment.

When updating from upstream, compare upstream workflow changes with these files
and deliberately port useful changes to the fork workflow. Git merges may
restore or conflict with upstream workflow paths: inspect `.github/workflows`
after every upstream merge and keep only intentionally enabled workflows there.
GitHub may retain historical workflow entries and run history after a definition
is moved; their UI lifecycle is controlled by GitHub.
