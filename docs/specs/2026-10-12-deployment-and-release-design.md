# Deployment and release design

## Scope

Add image publishing commands, automatic dev deployment, and tag-triggered production releases to this repository. Server provisioning and custom Compose configuration remain external. Brief deployment downtime is acceptable.

## Version and artifacts

- Stable annotated `vX.Y.Z` tags define one version for Talqo, docs, and the SDK.
- Local container pushes use mutable `dev` tags. Manual pushes and CI share those tags, so the last writer wins.
- Automated deployments use the exact digests returned by image publication. Mutable `dev` tags are convenience aliases and cannot change what a CD run deploys. Both image `latest` aliases move after successful prod deployment and SDK publication.
- Before 1.0, breaking public changes require a minor bump; patch releases remain backward-compatible.
- Build for `linux/amd64` initially. Images record source, revision, and version in OCI labels.
- Weekly GHCR cleanup removes untagged images older than seven days while preserving tagged images and their referenced manifests. Manual cleanup defaults to a dry run.

## Workflow boundaries

```text
PR/manual -> CI
main push -> CD -> CI -> publish Talqo dev image -> deploy Talqo dev
version tag -> Release -> CI with E2E -> publish images + build SDK
                       -> stage SDK -> npm approval with 2FA -> GitHub prod approval
                       -> deploy prod -> promote latest -> GitHub release
```

`ci.yml` owns checks, tests, and validation builds. `cd.yml` handles main pushes and calls CI directly before publication. `release.yml` calls the same CI workflow with E2E enabled. CI also runs independently for PRs and manual requests.

Docs have one production deployment, updated only by versioned releases. Main CD does not publish or deploy docs. Manual local docs pushes remain available for image testing.

Main CD passes its exact commit SHA to the shared publication and deployment workflows. Avoid workflow-run event chaining, duplicate main checks, and privileged checkout of PR code. PR/main checks exclude browser E2E; release and manual checks include it.

Use GitHub-hosted runners, read-only default permissions, pinned actions/toolchains, and per-job publication permissions. Dev/prod credentials belong to their GitHub environments. Serialize CD and releases without cancelling active deployment operations. Release runs use native multi-run queuing so later tags do not replace pending releases.

## Commands and reuse

Root package commands invoke small shell wrappers for image publishing, release tags, and SDK packing. They share release guards and use Git, Docker, jq, Bun, and gh directly. Validate shell syntax with ShellCheck; do not introduce a scripts package, scripts-only TypeScript configuration, or custom script test suites.

Publishing and deployment workflows are reused by main CD and releases. CI uses Docker's login, metadata, and build-push actions with separate GitHub Actions layer caches for the two images. Manual dev pushes retain native Docker commands. Registry namespaces come from the GitHub repository owner or the local origin remote. Release side effects recheck version order against completed releases, not newer queued tags, so older failed-job retries cannot promote a superseded release.

The release command creates and pushes only the annotated tag. It requires a clean checkout at current remote main, a stable version, no existing tag, and increasing version order. CI independently validates the tag and main ancestry before privileged operations.

## SDK publication

The SDK remains authored in TypeScript. Bun bundles ESM JavaScript, and the existing SDK TypeScript config emits declarations usable by ESM consumers. The widget uses workspace source; npm consumers use the built distribution. Consumer documentation belongs in `apps/docs`.

`pack:sdk` leaves source versions unchanged. Build without OIDC access, lifecycle scripts, or restored caches. Transfer the tarball by immutable artifact ID to a separate job that runs `npm stage publish` through trusted publishing with automatic provenance.

Review the candidate in npm's Staged Packages tab or with `npm stage view` and `npm stage download`. Check its version and source against the release tag, approve with 2FA, and confirm publication before approving the GitHub `prod` deployment. CI does not approve stages or check publication; reviewers enforce this order.

## Deployment boundary

The reusable deployment workflow invokes `deploy dev <talqo-digest>` for dev and `deploy <version> <talqo-digest> <docs-digest>` for production through environment-specific restricted SSH keys. The key selects dev or prod externally. Production must deploy both exact digests and report success only when both are ready. The command must support same-version retries and reject routine production downgrades.

CI does not upload shell programs, Compose files, or application secrets to the server. Use pinned SSH host identity, noninteractive authentication, no forwarding, and a bounded timeout. A lost connection can leave the remote outcome uncertain. Database migration recovery remains the deployment owner's responsibility.

## Failure behavior

Publication, deployment, alias updates, and GitHub release creation are separate operations. Failed steps stop the pipeline and leave earlier successful operations intact. GitHub releases are created last through gh with generated notes; no custom release-record asset or draft-upload state machine is needed.

After staging succeeds, retry only failed downstream jobs. Do not rebuild or restage the candidate. Reject incorrect candidates on npm and cancel their GitHub runs; cancellation does not remove npm stages. Deployment failure leaves an approved SDK published. Retry deployment, not publication. Promote image aliases only after deployment succeeds; version-order guards reject superseded releases.

## Activation prerequisites

Configure container-package access/visibility, npm ownership and trusted publishing, and the dev/prod deployment endpoints and credentials. These are external settings, not repository-provisioned infrastructure. Live publication and deployment must be exercised after setup.

Before the next release tag:

- Set the `@talqo/sdk` trusted publisher to `Talqo/talqo`, workflow `release.yml`, no environment. Disable **Allow npm publish** and **Allow npm dist-tag**. Select **Require two-factor authentication and disallow tokens** under publishing access. Revoke unused automation tokens.
- Require reviewers on the GitHub `prod` environment and disable administrator bypass. Enable **Prevent self-review** when another maintainer can approve. Allow only tags matching `v*`; protect release tags from unauthorized creation, updates, and deletion. Without required reviewers, deployment starts after staging without waiting for npm approval.
- Pending approvals block later releases. Cancel rejected or expired runs to unblock the queue, and reject their npm stages.

New npm publisher configurations need a successful publish within two days or they expire. Exercise live staging, 2FA approval, GitHub approval, and deployment after setup; a dry-run cannot verify authorization. References: [npm staging](https://docs.npmjs.com/staged-publishing/), [trusted publishing](https://docs.npmjs.com/trusted-publishers/), [GitHub environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).
