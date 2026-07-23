# Conceptual Entity Relationship Diagram

Entities and relationships only — no columns or types. Column-level design is deferred until each module's implementation settles on what it actually needs.

```mermaid
erDiagram
    ACCOUNT
    USER
    ACCOUNT_MEMBER
    INVITATION
    ACCOUNT_ACTIVITY_LOG

    WIDGET
    AGENT_CONFIG
    BLACKLIST_WORD
    WIDGET_IP_RATE_LIMIT

    MCP_CONFIG
    AI_PROVIDER_CONFIG

    END_USER_SESSION
    CONVERSATION
    MESSAGE

    FILE_EMBEDDING
    USAGE_RECORD

    ACCOUNT ||--o{ ACCOUNT_MEMBER : ""
    USER ||--o{ ACCOUNT_MEMBER : ""
    ACCOUNT ||--o{ INVITATION : issues
    USER ||--o{ INVITATION : sends
    ACCOUNT ||--o{ ACCOUNT_ACTIVITY_LOG : ""
    USER ||--o{ ACCOUNT_ACTIVITY_LOG : performs

    ACCOUNT ||--o{ WIDGET : configures
    WIDGET ||--|| AGENT_CONFIG : has
    WIDGET ||--o{ BLACKLIST_WORD : defines
    ACCOUNT ||--o| AI_PROVIDER_CONFIG : configures
    ACCOUNT ||--o{ MCP_CONFIG : configures
    ACCOUNT ||--o{ USAGE_RECORD : generates
    ACCOUNT ||--o{ FILE_EMBEDDING : embeds

    WIDGET ||--o{ END_USER_SESSION : receives
    END_USER_SESSION ||--o{ CONVERSATION : contains
    CONVERSATION ||--o{ MESSAGE : includes
    MESSAGE ||--o{ USAGE_RECORD : tracks
```
