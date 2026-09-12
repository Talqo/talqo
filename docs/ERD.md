# Conceptual Entity Relationship Diagram

Entities and relationships only; implementation schemas remain authoritative for columns and types.

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

    CONVERSATION_SESSION
    CONVERSATION
    CONVERSATION_ATTEMPT
    CONVERSATION_MESSAGE
    CONVERSATION_DAILY_COUNTER

    FILE_EMBEDDING
    CONVERSATION_USAGE

    USER ||--o{ SESSION : authenticates
    USER ||--o{ USER_ROLE : has
    USER ||--o{ INVITATION : sends
    USER ||--o{ PERMISSION_GRANT : holds
    USER ||--o{ AUDIT_LOG : performs

    AGENT ||--o{ EMBED : serves
    AGENT ||--o{ BLACKLIST_WORD : defines
    AGENT ||--o{ FILE_EMBEDDING : embeds

    AGENT ||--o{ CONVERSATION : receives
    AGENT ||--o{ CONVERSATION_DAILY_COUNTER : limits
    EMBED o|--o{ CONVERSATION : originated
    EMBED o|--o{ CONVERSATION_SESSION : authorizes
    CONVERSATION ||--|| CONVERSATION_SESSION : authorizes
    CONVERSATION ||--o{ CONVERSATION_ATTEMPT : accepts
    CONVERSATION ||--o{ CONVERSATION_MESSAGE : includes
    CONVERSATION_SESSION ||--o{ CONVERSATION_ATTEMPT : submits
    CONVERSATION_ATTEMPT ||--|{ CONVERSATION_MESSAGE : produces
    CONVERSATION_ATTEMPT ||--o| CONVERSATION_USAGE : records
```

One session authorizes one conversation. An embed's public token and `accessVersion` establish initial access, while only the hash of the private session credential is retained. Embed rotation, reassignment, or deletion revokes session access; nullable embed references preserve history after embed deletion. Agent deletion cascades conversations, sessions, attempts, messages, daily counters, and usage.
