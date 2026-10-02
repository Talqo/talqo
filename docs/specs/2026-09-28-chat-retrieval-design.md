# Chat Retrieval Design

## Status

Proposed (2026-09-28).

## Goal And Scope

Answer end-user chat from uploaded knowledge when it exists. On each send, embed the user message with the deployment's configured embedding model, retrieve the closest ready chunks for the agent, and include them in the text-model input. When no knowledge applies, chat behaves as today. This change adds query-time retrieval only; ingestion, chunking, file states, provider configuration, and chat lifecycle are unchanged.

Included:

- Query embedding through the existing `ai-provider` embedding operation.
- Similarity search over `ready` chunks scoped to the agent, ordered by vector distance, fixed top-K.
- Context injection into the assembled model input with an ignore-if-irrelevant guard.
- Silent degradation on retrieval failure: chat uses whatever chunks were retrieved and never inspects readiness.
- Retrieval text included in existing input-token accounting.

Excluded:

- Score thresholds, reranking, hybrid search, and per-agent retrieval settings.
- New modules, tables, migrations, error codes, dashboard UI, or public contract changes.
- Website crawling, user-defined chunking, and summary indexes.

## Boundaries And Ownership

- `knowledge-base` owns chunk vectors and retrieval queries. It exposes `searchKnowledge(agentId, text): Promise<string[]>` from its service. No other module queries `agent_file` or `agent_file_chunk` at runtime.
- `conversation` owns the send operation and orchestrates retrieval as one service call inside `prepareAndAccept`, before text-model preparation. It does not construct embedding models or SQL.
- `ai-provider` owns both model operations. Retrieval reuses `prepareEmbeddingOperation()` (key + `embed`), so query embeddings always use the current configuration.
- Dependency direction is `conversation -> knowledge-base -> ai-provider`. No reverse or cyclic service imports.

## Data And Workflow

- `TOP_K = 5`, a code constant owned by `knowledge-base`. No operator setting in v1.
- Repository adds `search(agentId, embedding, modelKey, limit)`:
  ```sql
  SELECT c.text FROM agent_file_chunk c
  JOIN agent_file f ON f.id = c.file_id
  WHERE f.agent_id = :agentId AND f.status = 'ready' AND f.model_key = :modelKey
  ORDER BY c.embedding <=> :embedding::vector LIMIT :limit
  ```
  Filtering by `model_key` excludes stale ready rows during a model-change reindex window.
- Service `searchKnowledge(agentId, text)`:
  1. `operation = await prepareEmbeddingOperation()` (throws `UnusableConfigurationError` when missing/unusable).
  2. `vector = await operation.embed(text)` (provider errors propagate).
  3. Return up to `TOP_K` texts in rank order — fewer when fewer match, empty array when none match. The search itself checks nothing else; the caller treats empty as no-context.
- `conversation.prepareAndAccept`, after loading history and before `dependencies.prepare`:
  1. Retrieve chunks: `chunks = await knowledgeBase.searchKnowledge(agentId, input.text)`.
  2. When non-empty, build the final user turn as `Use the context below only if relevant to the question, otherwise ignore it.\n<chunks>\n\nQuestion: <text>`. The system message stays stable so provider prefix caches keep hitting on `system + history`; only the new RAG suffix is reprocessed. Stored history keeps the raw user text (`messageText: input.text`), so chunks never persist or duplicate into later prompts.
  3. Augment before the existing input-length check, so `promptText`, usage estimation, and `ConversationTooLongError` enforcement all cover the augmented input with no separate accounting path.
- History pairing, blacklist filtering, streaming, cancellation, idempotency, and allowances are unchanged.

## Failure Behavior

- No `ready` chunks for the agent, or search returns zero rows: proceed without context. Retrieval was irrelevant.
- `searchKnowledge` is dumb: embed, search, return up to `TOP_K` (possibly zero), or throw. It makes no readiness decisions.
- When it throws, `conversation` logs a structured `knowledge-base.retrieval.degraded` event and proceeds without context. Readiness is the operator's responsibility — the file list already shows embedding status — so chat never inspects it and never fails on retrieval.
- Raw provider errors, embeddings, and configuration stay out of public responses.

## Verification And Acceptance

- Unit (`knowledge-base.test.ts`): user-turn formatting, guard wording, empty-chunks no-op.
- Integration through service interfaces:
  - Relevant chunks are injected in rank order and counted in estimated input tokens.
  - Zero rows / no ready files: send succeeds without context.
  - Thrown retrieval: send succeeds without context; degraded event logged.
  - Stale `model_key` rows are excluded from results.
- Regression: `bun run test`, `test:integration` for `knowledge-base` and `conversation` modules. No E2E or contract changes.

## Decision

Fixed top-5 retrieval without a score threshold, owned by `knowledge-base` and orchestrated by `conversation`, degrading silently whenever retrieval throws.
