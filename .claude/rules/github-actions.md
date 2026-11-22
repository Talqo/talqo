---
paths:
  - "**/.github/workflows/*.{yml,yaml}"
  - "**/.github/**/action.{yml,yaml}"
  - "**/action.{yml,yaml}"
---

# GitHub Actions

## Jobs and caching

- Split jobs where permissions or runners differ, or where work can run independently. Reuse the project's build and test commands.
- Connect dependent jobs with `needs`. Pass small values as job outputs and build products as artifacts.
- Key package download caches on the lockfile and any platform or toolchain details that affect the packages. Keep installs working on cache misses. Keep credentials out of caches.

## Security and deployment

- Start with read-only repository permissions. Grant extra permissions to the jobs that need them. Keep fork-controlled code and artifacts out of privileged jobs, including `pull_request_target` jobs. Prefer OIDC to long-lived cloud credentials.
- Deploy the tested artifact after the required build and test jobs pass. Use a protected environment and a concurrency group per deployment target.
- Keep required check names stable. When changing job names, filters, or conditions, verify how required checks behave on pushes and pull requests.

## Verification

- Use the project's workflow linter, or `actionlint` when available. Run affected jobs with `act` where supported. Use representative event payloads and test credentials.
- Verify permissions, protected environments, OIDC, and concurrency on GitHub.
