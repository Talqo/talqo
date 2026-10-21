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
version tag -> Release -> CI with E2E -> publish images
                       -> deploy prod -> publish SDK -> promote latest -> GitHub release
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

`pack:sdk` uses Bun to build and pack a staged public manifest without modifying source package versions. The release job publishes that exact tarball using npm trusted publishing and automatic provenance. npm/Node are confined to that job because Bun does not support this authentication flow. There is no separate SDK consumer or custom registry/signature verification stage.

## Deployment boundary

The reusable deployment workflow invokes `deploy dev <talqo-digest>` for dev and `deploy <version> <talqo-digest> <docs-digest>` for production through environment-specific restricted SSH keys. The key selects dev or prod externally. Production must deploy both exact digests and report success only when both are ready. The command must support same-version retries and reject routine production downgrades.

CI does not upload shell programs, Compose files, or application secrets to the server. Use pinned SSH host identity, noninteractive authentication, no forwarding, and a bounded timeout. A lost connection can leave the remote outcome uncertain. Database migration recovery remains the deployment owner's responsibility.

## Failure behavior

Publication, deployment, alias updates, and GitHub release creation are separate operations. Failed steps stop the pipeline and leave earlier successful operations intact. GitHub releases are created last through gh with generated notes; no custom release-record asset or draft-upload state machine is needed.

npm handles version collisions and publication errors. If SDK publication already succeeded, rerun only the failed downstream jobs rather than publishing the same version again. Rebuilding images can produce new digests; deployment always uses outputs from the successful build jobs. npm publication and image aliases never move before prod succeeds, and version-order guards prevent older retries from promoting a superseded release.

## Activation prerequisites

Configure container-package access/visibility, npm ownership and trusted publishing, and the dev/prod deployment endpoints and credentials. These are external settings, not repository-provisioned infrastructure. Live publication and deployment must be exercised after setup.

Before the first release tag, verify the `@talqo/sdk` trusted publisher in npm package settings matches owner `Talqo`, repository `talqo`, workflow `release.yml`, and no environment, with direct `npm publish` allowed. New publisher configurations expire unless their first publish succeeds within two days. A dry-run publish does not verify authorization. Dispatch CI manually to exercise browser E2E before releasing. A failed SDK publish leaves production deployed; rerun the failed jobs after fixing npm configuration.
