# Conceptual Entity Relationship Diagram

This diagram models the desired entities and relationships. Implementation schemas remain authoritative for columns and types.

```mermaid
erDiagram
    USER
    SESSION
    USER_ROLE
    INVITATION
    PERMISSION_GRANT
    AUDIT_LOG

    AGENT
    EMBED
    BLACKLIST_WORD

    MCP_CONFIG
    AI_PROVIDER_CONFIG

    CONVERSATION
    GENERATION_ATTEMPT
    MESSAGE
    CONVERSATION_DAILY_COUNTER

    FILE_EMBEDDING
    USAGE_RECORD

    USER ||--o{ SESSION : authenticates
    USER ||--o{ USER_ROLE : has
    USER ||--o{ INVITATION : sends
    USER ||--o{ PERMISSION_GRANT : holds
    USER ||--o{ AUDIT_LOG : performs

    AGENT ||--o{ EMBED : serves
    AGENT ||--o{ BLACKLIST_WORD : defines
    AGENT ||--o{ MCP_CONFIG : configures
    AGENT ||--o{ FILE_EMBEDDING : embeds

    AGENT ||--o{ CONVERSATION : receives
    AGENT ||--o{ CONVERSATION_DAILY_COUNTER : limits
    EMBED o|--o{ CONVERSATION : originated
    CONVERSATION ||--o{ GENERATION_ATTEMPT : accepts
    CONVERSATION ||--o{ MESSAGE : includes
    GENERATION_ATTEMPT ||--|{ MESSAGE : produces
    GENERATION_ATTEMPT ||--o| USAGE_RECORD : records
```
