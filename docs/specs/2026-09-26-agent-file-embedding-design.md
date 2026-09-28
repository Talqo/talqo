# Agent File Embedding Design

## Status

Accepted (2026-09-26).

## Goal And Scope

An authorized operator uploads `.txt`, `.md`, `.docx`, or `.pdf` files to an agent. Every uploaded file is converted and chunked with Docling's `HybridChunker`, then embedded with the deployment's configured embedding model. Operators see pending, processing, ready, or failed, can retry failed files, and receive a warning before a configuration change that rebuilds embeddings. Conversion and embedding are serial across the deployment. This change stores chunks and vectors; chat retrieval, similarity indexes, website crawling, and user-defined chunking settings are separate work.

## Boundaries

- **Talqo API remains Bun/TypeScript.** No Python files, Python environment, Python subprocess, or Docling runtime is bundled into any Talqo app image.
- **Docling Serve is a required, separately deployed service.** `bun run dev` starts a pinned CPU image in Compose, discovers its published port, and passes its private URL to the API automatically; operators do not configure Docling in the dashboard. Other deployment templates must wire the private endpoint as part of deployment, without an operator setup step. The API submits original bytes to synchronous `POST /v1/chunk/hybrid/file` with a fixed token limit for both text and non-text files. Validate the bounded response and use a timeout; do not accept user-supplied Docling URLs.
- **Original files remain on the API-owned filesystem.** Uploads, downloads, and ingestion jobs need the same persistent directory; Docling receives bytes over HTTP. A deployment with replica-local storage must run one API replica. Multiple replicas require shared file storage or a later object-storage change; PostgreSQL locking alone cannot share files.
- **One module owns uploaded files and their embeddings:** `knowledge-base` owns file metadata, ingestion queue state, and chunk-vector tables. Its service owns upload, rename, delete, retry, crash reconciliation, and state transitions. The HTTP routes call its service after agent/permission checks. It calls the `ai-provider` service for the embedding model and the Docling HTTP boundary for chunks. `agent` calls `knowledge-base` for directory cleanup, so the ingestion worker has no reverse service dependency. The dashboard's `context` label remains presentation terminology; the API module's scope is stored knowledge sources, not conversation context or RAG at chat time.

## Data And Workflow

- One `agent_file` row per original file, with agent ID, name, status, safe failure code, model fingerprint, and generation/fencing number. Unique `(agent_id, name)`; deleting an agent cascades its DB records. One `agent_file_chunk` row per position with text and a dimension-agnostic pgvector value, cascading from the file.
- **Why two tables:** a file with zero extracted chunks still needs pending/failed state, a retry target, and a generation fence. Putting a file name on each chunk cannot represent that state without a fake chunk row or a second store (for example, filesystem sidecars). The file row is the durable work item; chunk rows are produced only on success. This is two relational shapes inside one module, not two business modules.
- On upload, write the bounded, validated file, create a pending DB record, then answer success. If DB creation fails, compensate the filesystem write. Reconcile pre-existing or interrupted disk uploads on worker startup. Renames update the source name and fence active work; deletes remove the source and records. Make partial filesystem/DB failures explicit and recoverable; never expose ready for a missing file.
- One API worker holds a PostgreSQL session advisory lock for the deployment. It claims one pending file at a time. For that file, call Docling once and await **each** embedding request serially, with SDK retries disabled. No parallel files or parallel provider calls. If the API dies, another lock holder requeues interrupted records; generation checks prevent old results from overwriting new work.
- A conversion/provider error marks the file failed with a safe, localized failure code; it does not automatically retry at a rate-limited provider. An operator's authenticated retry action moves only a failed file back to pending. Keep the previous chunk set until a full replacement succeeds, and publish replacement chunks and ready state in one transaction. Future retrieval must use only ready files whose model fingerprint matches the current configuration.
- The model fingerprint includes provider, model ID, and relevant connection settings, with stable key ordering. A change automatically queues existing files for re-embedding. The AI configuration page asks for confirmation **before save** when these values change; the warning names time, provider charges, and serial processing. Cancel preserves the unsaved form. The file list polls while work is active, shows failures, and offers Retry embedding beside failed files. Text-generation-only edits do not trigger the warning.
- The substantial AI configuration page UI lives in `features/ai-configuration`; its route owns access and route lifecycle only. Small routes do not require forced feature wrappers.

## PostgreSQL And Migrations

PostgreSQL remains the only Talqo datastore; pgvector is an installed database extension. Use **one new generated Drizzle migration** for both file and chunk tables. The centralized migration runner creates the extension idempotently before applying that migration, because Drizzle's generated table SQL assumes the vector type already exists. There is no separate extension migration. The migration role needs extension-creation rights, or an administrator must pre-provision the extension. Compose uses a pinned pgvector-enabled PostgreSQL image; AWS and Kubernetes deployments must supply a compatible extension-enabled PostgreSQL installation. Do not hand-edit generated SQL or metadata, and do not rewrite any previously shared migration.

## Verification And Rollout

- Unit and integration tests cover serial ordering, failed-file retry, fencing, vector persistence, and file rename/delete. The Docling HTTP boundary uses a controlled response; the browser test verifies confirmation before a model change. No Python tooling is required for Talqo tests.
- Keep the Docling Serve image pinned and verify its chunk response schema when upgrading. Document its private endpoint and persistent file-storage requirement in deployment instructions.

## Decision

`knowledge-base` is the single source-file and chunk owner. Docling Serve is an external required service, initial deployments use one API replica with persistent local uploads, and a single generated schema migration follows extension setup in the centralized migrator.
