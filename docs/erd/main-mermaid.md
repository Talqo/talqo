```mermaid
erDiagram
    ACCOUNT {
        uuid id PK
        string name
        decimal balance_usd
        decimal monthly_usage_limit
        decimal usage_alert_threshold_usd
        string status
        datetime created_at
    }

    USER {
        uuid id PK
        string name
        string email
        string password_hash
        datetime last_active
        datetime created_at
    }

    ACCOUNT_MEMBER {
        uuid account_id FK
        uuid user_id FK
        enum role
        datetime created_at
    }

    INVITATION {
        uuid token PK
        uuid account_id FK
        string email
        enum role
        uuid invited_by_user_id FK
        datetime expires_at
        datetime consumed_at
    }

    ACCOUNT_ACTIVITY_LOG {
        uuid id PK
        uuid account_id FK
        uuid actor_user_id FK
        string action_type
        datetime created_at
    }

    WIDGET {
        uuid id PK
        uuid account_id FK
        uuid widget_token
        string bot_name
        string position
        JSONB light_colors
        JSONB dark_colors
        JSONB icons
        boolean widget_setup_dismissed
        datetime updated_at
    }

    BOT_CONFIG {
        uuid id PK
        uuid widget_id FK
        text system_prompt
        string default_role
        string tone_style
        datetime updated_at
    }

    BLACKLIST_WORD {
        uuid id PK
        uuid widget_id FK
        string word
        datetime created_at
    }

    WIDGET_IP_RATE_LIMIT {
        string ip PK
        datetime window PK
        int count
    }

    CUSTOM_MCP_SERVER {
        uuid id PK
        uuid account_id FK
        JSONB mcp_config
    }

    PRE_MADE_MCP_SERVER {
        uuid id PK
        JSONB mcp_config
        string name
        text description
    }

    ACCOUNT_PRE_MADE_MCP {
        uuid account_id FK
        uuid pre_made_mcp_id FK
    }

    END_USER_SESSION {
        uuid id PK
        uuid widget_id FK
        string browser_session_id
        datetime created_at
        datetime last_active_at
    }

    CONVERSATION {
        uuid id PK
        uuid session_id FK
        datetime started_at
        int satisfaction_rating
    }

    FILE_EMBEDDING {
        uuid id PK
        uuid account_id FK
        text file_path
        int chunk_index
        text chunk_text
        vector embedding
        int embedding_dimensions
        datetime created_at
    }

    MESSAGE {
        uuid id PK
        uuid conversation_id FK
        enum role
        text content
        int token_count
        datetime created_at
    }

    USAGE_RECORD {
        uuid id PK
        uuid account_id FK
        uuid message_id FK
        enum type
        int tokens_used
        decimal cost_usd
        datetime recorded_at
    }

    AI_PROVIDER_CONFIG {
        uuid id PK
        uuid account_id FK
        enum provider_type
        text api_key_encrypted
        string model
        string embedding_model
        text base_url
        datetime updated_at
    }

    PASSWORD_RESET_TOKEN {
        uuid token PK
        string email
        datetime expires_at
        datetime consumed_at
    }

    ACCOUNT ||--o{ ACCOUNT_MEMBER : ""
    USER ||--o{ ACCOUNT_MEMBER : ""
    ACCOUNT ||--o{ INVITATION : issues
    USER ||--o{ INVITATION : sends
    ACCOUNT ||--o{ ACCOUNT_ACTIVITY_LOG : ""
    USER ||--o{ ACCOUNT_ACTIVITY_LOG : performs

    ACCOUNT ||--o{ WIDGET : configures
    WIDGET ||--|| BOT_CONFIG : has
    WIDGET ||--o{ BLACKLIST_WORD : defines
    ACCOUNT ||--o| AI_PROVIDER_CONFIG : configures
    ACCOUNT ||--o{ CUSTOM_MCP_SERVER : configures
    ACCOUNT ||--o{ ACCOUNT_PRE_MADE_MCP : ""
    PRE_MADE_MCP_SERVER ||--o{ ACCOUNT_PRE_MADE_MCP : ""
    ACCOUNT ||--o{ USAGE_RECORD : generates
    ACCOUNT ||--o{ FILE_EMBEDDING : embeds

    WIDGET ||--o{ END_USER_SESSION : receives
    END_USER_SESSION ||--o{ CONVERSATION : contains
    CONVERSATION ||--o{ MESSAGE : includes
    MESSAGE ||--o{ USAGE_RECORD : tracks

    USER ||--o{ PASSWORD_RESET_TOKEN : "requests (by email)"

```