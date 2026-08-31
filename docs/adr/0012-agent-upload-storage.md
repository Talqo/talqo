# 0012: Agent file upload storage

## Status

Accepted (2026-08-31)

## Context

Agent knowledge files are uploaded through the API and stored on the local filesystem under `TALQO_UPLOAD_DIR`. The initial default resolved into the repository checkout, which mixed user data with the code bundle, required a `.gitignore` exception, and — worse — would have been the silent production behavior: files in a code-directory tmp vanish on every redeploy and are per-replica, so one pod could never serve or clean another pod's uploads.

## Decision

- In development and tests, `TALQO_UPLOAD_DIR` defaults to a `talqo` directory in the OS temp dir (`/tmp/talqo` on Linux), which is ephemeral by design.
- In production the API refuses to boot without an explicit `TALQO_UPLOAD_DIR` (same fail-fast pattern as `APP_SECRET`), and that directory must live on a persistent volume shared read-write-many across all API replicas.

## Consequences

Deleting an agent removes its upload directory only on the serving pod's view of storage; a shared volume keeps uploads, listings, and cleanup consistent across replicas. The `.gitignore` `/tmp/` entry now covers only integration-test artifacts under the repo root, never live data.
