# Module Architecture

Talqo is a modular monolith: one API process (`apps/api`), one PostgreSQL database. Business capabilities live in modules under `apps/api/src/modules/<module>`, each owning its own tables and exposing behavior only through a service. Modules call each other's services directly (in-process), never each other's repositories or tables.

We want a **small, explicit, acyclic** dependency graph: every arrow below is a runtime service call in the desired architecture and there are no cycles. Schema-only foreign-key imports used for deletion integrity are not service arrows.

## Module Dependency Graph

```mermaid
graph LR
    subgraph "Identity & Access"
        identity[identity]
        roles[roles]
    end

    subgraph "Configuration"
        agent[agent]
        embed[embed]
        ai_provider["ai-provider"]
        mcp[mcp]
        knowledge[knowledge]
    end

    subgraph "Runtime"
        conversation[conversation]
    end

    subgraph "Observability"
        usage[usage]
        audit[audit]
    end

    roles --> identity

    agent --> roles
    agent --> ai_provider
    agent --> mcp
    agent --> knowledge
    embed --> agent
    embed --> roles
    ai_provider --> roles
    mcp --> roles
    knowledge --> roles

    conversation --> embed
    conversation --> agent
    conversation --> usage

    roles --> audit
    agent --> audit
    mcp --> audit
    ai_provider --> audit
```

`identity`, `usage`, and `audit` are leaves. `audit` only receives calls as an activity-log sink. `conversation` owns the public send operation and conversation persistence. It delegates response generation through `agent`, which encapsulates AI-provider access, knowledge retrieval, and MCP execution.

## Modules

| Module | Owns (tables) | Responsibility |
|---|---|---|
| `identity` | `USER`, `SESSION` | Who a person is: login credentials and active sessions. No knowledge of roles. |
| `roles` | `USER_ROLE`, `INVITATION`, `PERMISSION_GRANT` | RBAC role assignment, invite flow, and deployment-global permission grants — owns "who can do what." |
| `agent` | `AGENT`, `BLACKLIST_WORD` | Deployment-owned response configuration: identity, system prompt, output blacklist, AI provider, knowledge, and MCP tools. |
| `embed` | `EMBED` | Embeddable surfaces: appearance, public embed token, access version, and the agent each one serves. One agent serves many embeds. |
| `ai-provider` | `AI_PROVIDER_CONFIG` | Per-agent model-provider credentials and model selection. |
| `mcp` | `MCP_CONFIG` | Per-agent tool-server integrations used during response generation. |
| `knowledge` | `FILE_EMBEDDING` | RAG ingestion, per-agent embedding storage, and retrieval for response context. |
| `conversation` | `CONVERSATION_SESSION`, `CONVERSATION`, `CONVERSATION_ATTEMPT`, `CONVERSATION_MESSAGE`, `CONVERSATION_DAILY_COUNTER` | Public multi-turn runtime, bearer authorization, conversation history, accepted-question counters, and fenced generation leases. |
| `usage` | `CONVERSATION_USAGE` | Stores normalized input/output usage once per model-call attempt; it does not enforce billing or deployment quotas. |
| `audit` | `AUDIT_LOG` | Sink module: records actions performed by other modules. No outgoing dependencies. |

Every entity in [`docs/ERD.md`](../ERD.md) is owned by exactly one module, matching the "a module writes only its own tables" rule.
