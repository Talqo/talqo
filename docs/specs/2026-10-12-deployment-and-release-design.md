# Deployment and release design

## Scope

Add image publishing commands, automatic dev deployment, and tag-triggered production releases to this repository. Server provisioning and custom Compose configuration remain external. Brief deployment downtime is acceptable.

## Version and artifacts

- Stable annotated `vX.Y.Z` tags define one version for Talqo, docs, and the SDK.
- Local container pushes use mutable `dev` tags. Manual pushes and CI share those tags, so the last writer wins.
- Production uses explicit versioned images. Both image `latest` aliases move after successful prod deployment.
- Before 1.0, breaking public changes require a minor bump; patch releases remain backward-compatible.
- Build for `linux/amd64` initially. Images record source, revision, and version in OCI labels.

## Workflow boundaries

```text
PR/manual -> CI
main push -> CD -> CI -> publish dev images -> deploy dev
version tag -> Release -> CI with E2E -> publish images/SDK
                       -> deploy prod -> promote latest -> GitHub release
```

`ci.yml` owns checks, tests, and validation builds. `cd.yml` handles main pushes and calls CI directly before publication. `release.yml` calls the same CI workflow with E2E enabled. CI also runs independently for PRs and manual requests.

Main CD passes its exact commit SHA to the shared publication and deployment workflows. Avoid workflow-run event chaining, duplicate main checks, and privileged checkout of PR code. PR/main checks exclude browser E2E; release and manual checks include it.

Use GitHub-hosted runners, read-only default permissions, pinned actions/toolchains, and per-job publication permissions. Dev/prod credentials belong to their GitHub environments. Serialize CD and releases without cancelling active deployment operations.

## Commands and reuse

Root package commands invoke small shell wrappers for image publishing, release tags, and SDK packing. They share release guards and use Git, Docker, jq, Bun, and gh directly. Validate shell syntax with ShellCheck; do not introduce a scripts package, scripts-only TypeScript configuration, or custom script test suites.

Publishing and deployment workflows are reused by main CD and releases. Docker owns registry authentication, including credential helpers. Stable images already published for a release are reused only when their source/revision/version labels match; do not overwrite them on retry. Publication and deployment recheck freshness in the actual attempted job so failed-job reruns cannot reuse stale decisions.

The release command creates and pushes only the annotated tag. It requires a clean checkout at current remote main, a stable version, no existing tag, and increasing version order. CI independently validates the tag and main ancestry before privileged operations.

## SDK publication

The SDK remains authored in TypeScript with the existing extensionless import convention. Bun bundles ESM JavaScript, and the existing SDK TypeScript config emits declarations. The widget uses workspace source; npm consumers use the built distribution. Consumer documentation belongs in `apps/docs`.

`pack:sdk` uses Bun to build and pack a staged public manifest without modifying source package versions. The release job publishes that exact tarball using npm trusted publishing and automatic provenance. npm/Node are confined to that job because Bun does not support this authentication flow. There is no separate SDK consumer or custom registry/signature verification stage.

## Deployment boundary

The reusable deployment workflow invokes only `deploy <version>` through an environment-specific restricted SSH key. The key selects dev or prod externally. The supplied command must deploy both image versions, report success only when both are ready, support same-version retries, and reject routine production downgrades.

CI does not upload shell programs, Compose files, or application secrets to the server. Use pinned SSH host identity, noninteractive authentication, no forwarding, and a bounded timeout. A lost connection can leave the remote outcome uncertain. Database migration recovery remains the deployment owner's responsibility.

## Failure behavior

Publication, deployment, alias updates, and GitHub release creation are separate operations. Failed steps stop the pipeline and leave earlier successful operations intact. GitHub releases are created last through gh with generated notes; no custom release-record asset or draft-upload state machine is needed.

npm handles version collisions and publication errors. Docker registry lookup errors fail rather than masquerading as absent images. Image aliases never move before prod succeeds, and freshness guards prevent older retries from promoting a superseded release.

## Activation prerequisites

Configure container-package access/visibility, npm ownership and trusted publishing, and the dev/prod deployment endpoints and credentials. These are external settings, not repository-provisioned infrastructure. Live publication and deployment must be exercised after setup.
