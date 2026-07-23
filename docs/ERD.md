# Conceptual Entity Relationship Diagram

Entities and relationships only — no columns or types. Column-level design is deferred until each module's implementation settles on what it actually needs.

```mermaid
erDiagram
    USER
    USER_ROLE
    INVITATION
    AUDIT_LOG

    AGENT
    AGENT_CONFIG
    BLACKLIST_WORD
    AGENT_IP_RATE_LIMIT

    MCP_CONFIG
    AI_PROVIDER_CONFIG

    END_USER_SESSION
    CONVERSATION
    MESSAGE

    FILE_EMBEDDING
    USAGE_RECORD

    USER ||--o{ USER_ROLE : has
    USER ||--o{ INVITATION : sends
    USER ||--o{ AUDIT_LOG : performs

    USER ||--o{ AGENT : configures
    AGENT ||--|| AGENT_CONFIG : has
    AGENT ||--o{ BLACKLIST_WORD : defines
    AGENT ||--o{ AGENT_IP_RATE_LIMIT : defines
    AGENT ||--o{ FILE_EMBEDDING : embeds

    AGENT ||--o{ END_USER_SESSION : receives
    END_USER_SESSION ||--o{ CONVERSATION : contains
    CONVERSATION ||--o{ MESSAGE : includes
    MESSAGE ||--o{ USAGE_RECORD : tracks
```
