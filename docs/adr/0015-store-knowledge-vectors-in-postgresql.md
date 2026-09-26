# 0015: Store knowledge vectors in PostgreSQL

## Status

Accepted (2026-09-26)

## Context

Knowledge ingestion needs durable file state and vectors, while Talqo already runs PostgreSQL. A separate vector database adds another deployment and consistency boundary. Operators can choose models with different vector dimensions.

## Decision

Store file ingestion state and mixed-dimension chunk vectors in PostgreSQL using pgvector, without a similarity index until retrieval is implemented.

## Consequences

Uploads, retries, and model changes share one durable store; deployments must install the pgvector extension. A single database-locked worker serializes provider calls. Retrieval will need to filter by embedding-model identity and choose an index strategy when warranted.
