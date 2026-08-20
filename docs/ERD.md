# Conceptual Entity Relationship Diagram

Entities and relationships only — no columns or types. Column-level design is deferred until each module's implementation settles on what it actually needs.

```mermaid
erDiagram
    USER
    SESSION
    USER_ROLE
    INVITATION
    PERMISSION_GRANT
    AUDIT_LOG

    AGENT
    BLACKLIST_WORD
    AGENT_IP_RATE_LIMIT

    MCP_CONFIG
    AI_PROVIDER_CONFIG

    END_USER_SESSION
    CONVERSATION
    MESSAGE

    FILE_EMBEDDING
    USAGE_RECORD

    USER ||--o{ SESSION : authenticates
    USER ||--o{ USER_ROLE : has
    USER ||--o{ INVITATION : sends
    USER ||--o{ PERMISSION_GRANT : holds
    USER ||--o{ AUDIT_LOG : performs

    USER ||--o{ AGENT : configures
    AGENT ||--o{ PERMISSION_GRANT : scopes
    AGENT ||--o{ BLACKLIST_WORD : defines
    AGENT ||--o{ AGENT_IP_RATE_LIMIT : defines
    AGENT ||--o{ FILE_EMBEDDING : embeds

    AGENT ||--o{ END_USER_SESSION : receives
    END_USER_SESSION ||--o{ CONVERSATION : contains
    CONVERSATION ||--o{ MESSAGE : includes
    MESSAGE ||--o{ USAGE_RECORD : tracks
```
