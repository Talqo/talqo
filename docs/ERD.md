# Conceptual Entity Relationship Diagram

This diagram models the desired entities and relationships. Implementation schemas remain authoritative for columns and types.

```mermaid
erDiagram
    USER
    SESSION
    ROLE
    ROLE_PERMISSION
    ROLE_AGENT_PERMISSION
    USER_ROLE
    INVITATION
    INVITATION_ROLE
    PERMISSION_GRANT
    %% AUDIT_LOG is planned; no audit module or table exists yet.
    AUDIT_LOG

    AGENT
    EMBED
    BLACKLIST_WORD

    MCP_SERVER
    %% AI_PROVIDER_CONFIG is a deployment-wide singleton; no agent relationship.
    AI_PROVIDER_CONFIG

    CONVERSATION
    GENERATION_ATTEMPT
    MESSAGE
    CONVERSATION_DAILY_COUNTER

    AGENT_FILE
    AGENT_FILE_CHUNK
    USAGE_RECORD

    USER ||--o{ SESSION : authenticates
    USER ||--o{ USER_ROLE : has
    ROLE ||--o{ USER_ROLE : "assigned through"
    ROLE ||--o{ ROLE_PERMISSION : includes
    ROLE ||--o{ ROLE_AGENT_PERMISSION : grants
    AGENT ||--o{ ROLE_AGENT_PERMISSION : restricts
    USER ||--o{ INVITATION : sends
    INVITATION ||--o{ INVITATION_ROLE : includes
    ROLE ||--o{ INVITATION_ROLE : "selected through"
    USER ||--o{ PERMISSION_GRANT : holds
    USER |o--o{ PERMISSION_GRANT : "grants (granted_by)"
    USER ||--o{ AUDIT_LOG : performs

    AGENT ||--o{ EMBED : serves
    AGENT ||--o{ BLACKLIST_WORD : defines
    AGENT ||--o{ MCP_SERVER : configures
    AGENT ||--o{ AGENT_FILE : owns
    AGENT_FILE ||--o{ AGENT_FILE_CHUNK : contains

    AGENT ||--o{ CONVERSATION : receives
    AGENT ||--o{ CONVERSATION_DAILY_COUNTER : limits
    EMBED o|--o{ CONVERSATION : originated
    CONVERSATION ||--o{ GENERATION_ATTEMPT : accepts
    CONVERSATION ||--o{ MESSAGE : includes
    GENERATION_ATTEMPT ||--|{ MESSAGE : produces
    GENERATION_ATTEMPT ||--o| USAGE_RECORD : records
    AGENT ||--o{ USAGE_RECORD : attributes
    CONVERSATION ||--o{ USAGE_RECORD : attributes
```
