# Software Requirements Specification

Revised 2026-10-25. Living document — the Completion column reflects implementation state verified against the code.

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for **Talqo**, an open-source, self-hosted AI chat agent that operators embed on their own websites.

### 1.2 Scope

Talqo covers the embeddable widget, the operator dashboard, and the connection SDK, packaged as a single self-hosted deployment that runs alongside PostgreSQL and a Docling Serve instance (§2.4). It does not cover deployment orchestration or multi-tenant hosting, billing, or back-office tooling.

### 1.3 Definitions & Acronyms

| Term | Meaning |
|------|---------|
| Agent | The configured AI persona (system prompt, blacklist, knowledge base, MCP tools) that answers end users; a deployment may run multiple agents |
| Embed | One configured website integration: the agent it points at, its public token, and its appearance. The SDK reads it, and any UI uses its token to talk to the API |
| MCP | Model Context Protocol — lets the agent call external tools/structured data sources |
| RAG | Retrieval-Augmented Generation — extracts relevant context from the knowledge base when responding to end user |
| SDK | The headless client (FR-3) any UI uses to talk to the API with an embed token |
| Widget | The pre-built, embeddable chat UI (FR-1); one of many UIs that can use an embed token through the SDK |
| Knowledge base | Content (uploaded files or crawled site pages) the agent references when answering |

### 1.4 Intended Audience

Contributors and implementers of the `talqo` repository.

## 2. Overall Description

### 2.1 Product Perspective

Talqo is related to these repos:

- **`talqo-deploy`** consumes `talqo`'s published container images to provide deployment recipes (Compose, Helm, Terraform). `talqo` does not include deployment orchestration itself.

### 2.2 User Classes

| Actor | Description |
|-------|-------------|
| **End user** | The visitor on the operator's website who chats with the widget |
| **Operator** | A dashboard user who configures the agent and monitors usage |
| **Developer** | A technical user integrating against the connection SDK instead of the pre-built widget |

### 2.3 Constraints

- Single-tenant only: one deployment serves exactly one operator (e.g. a company or dev group), which may run multiple agents — e.g. one per website, or multiple agents on the same site for A/B testing. The dashboard supports multiple operator accounts within that single tenant.
- Dashboard accounts are role-based: exactly one admin account exists per deployment, created via first-run setup (FR-2.1), and holds every permission. Other accounts receive permissions only through roles (FR-2.6b, FR-2.6c). There is no superadmin.
- The operator must supply their own AI provider authentication source; there is no platform-funded default.

### 2.4 Assumptions & Dependencies

- `talqo-deploy` is expected to consume the container images `talqo` publishes (NFR-1.3a) — `talqo` does not need to provide its own orchestration.
- PostgreSQL is available at deploy time and provides the authoritative relational datastore and vector similarity support for knowledge-base embeddings (FR-2.17).
- Docling Serve is a required, separately deployed service for knowledge-base ingestion (FR-2.14).
- Uploaded knowledge-base files (FR-2.14) are stored on the API replica's local filesystem, so such deployments must run exactly one API replica.
- The operator has baseline familiarity with Docker and environment-variable configuration.

## 3. Functional Requirements

### 3.1 Widget (FR-1)

> The embeddable chat widget rendered on the operator's website for end users.

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-1.1 | End user can send text messages to the agent and receive AI-generated responses (rendered as markdown) | High | Done |
| FR-1.2 | Conversation history is persisted server-side and survives page reloads via browser session ID | High | Done |
| FR-1.3 | Widget can be minimized and reopened without losing the conversation state | High | Done |
| FR-1.4 | Widget displays a typing indicator while the agent is generating a response | High | Done |
| FR-1.5 | End user can reset the current conversation, which starts a new chat session | Medium | Done |
| FR-1.6 | End user can rate individual agent responses with a thumbs up / thumbs down | Low | Not started |
| FR-1.7 | Widget can be resized by the end user on desktop (not available on mobile viewports) | Low | Done |
| FR-1.8 | End user can cancel a streaming reply | High | Done |
| FR-1.9 | End user can retry the last message after a failed turn | Medium | Done |
| FR-1.10 | Widget shows live MCP tool activity while the agent is calling tools | Low | Done |
| FR-1.11 | Widget and SDK handle degraded states: a revoked session (explain lost access, offer new chat), unavailable browser storage (continue in memory), and an invalid or unavailable embed (hide the widget) | Medium | Done |

### 3.2 Dashboard (FR-2)

> The web application where the operator configures the agent and monitors usage.

#### 3.2.1 Operator account & access (FR-2a)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.1 | On first deployment run, the operator is redirected to an admin setup page and must create the sole admin account before the dashboard becomes otherwise usable | High | Done |
| FR-2.2 | Operator accounts are created only by redeeming an invitation link; there is no self-service registration or email flow. An operator with user-management permission can create invitations with selected roles | High | Done |
| FR-2.2a | Invitations are single-use, expire after 7 days, and assign exactly their selected roles; redeeming signs the invitee in, and the inviter's authority is rechecked at redemption | High | Done |
| FR-2.3 | Operator can log in and log out of the dashboard | High | Done |
| FR-2.3a | Operator can log in via SSO (e.g. Google) as an alternative to username/password credentials | Medium | Not started |
| FR-2.4 | Operator can change their account password | Medium | Done |
| FR-2.4a | An operator with user-management permission can reset another operator account's password, provided they hold every permission that account has (no self-service password recovery exists, since there is no self-registration or email flow) | Medium | Done |
| FR-2.5 | Operator can update their account information (username) | Medium | Done |
| FR-2.6 | A non-admin operator can permanently delete their account from Account settings, ending all sessions while preserving shared agents and analytics; the admin account cannot be deleted | Medium | Done |
| FR-2.6a | An operator with user-management permission can delete another operator account they hold every permission of; deletion ends its sessions and removes its permissions | Medium | Done |
| FR-2.6b | An operator with role-management permission can create, rename, change and delete roles, each a named set of permissions | Medium | Done |
| FR-2.6c | An operator with role-management permission can assign several roles to an operator account; the account holds every permission of its roles | Medium | Done |
| FR-2.6d | An operator cannot give or remove access they do not hold themselves, including on a specific agent; password resets and account deletion obey the same bound | High | Done |
| FR-2.6e | An operator with role-management permission can give each role specific capabilities on individual agents: statistics, conversations, configuration, and deletion | High | Done |
| FR-2.6f | Invitations assign exactly their selected roles. The dashboard preselects an initially empty Default role, which can be deselected and edited but not deleted | Medium | Done |
| FR-2.7 | Operator can embed the widget on their website via a script tag (framework-independence constraint: NFR-1.1) | High | Done |
| FR-2.8 | Operator can rotate an embed's public token, which takes effect immediately: the old token stops working and existing chat sessions under that embed are revoked | Medium | Done |
| FR-2.8a | Operator with manage permission on an agent can create, edit, and enable or disable its embeds; an agent can serve multiple embeds | Medium | Done |
| FR-2.8b | Operator can reassign an embed to another agent, which requires manage permission on both agents and revokes its chat sessions | Medium | Done |
| FR-2.8c | Operator can delete an embed, which revokes its end-user sessions while preserving the conversations | Medium | Done |

#### 3.2.2 API configuration (FR-2b)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.9 | AI provider configuration is deployment-wide, not per-agent: an authorized operator must configure the text provider (endpoints, authentication source, model) before the agent can respond to end users. The embedding provider (FR-2.17) is separate; a broken embedding configuration degrades retrieval without blocking replies | High | Done |
| FR-2.9a | Operator can set a maximum token usage limit per period (deferred: period selection, persistence, notifications undecided) | High | Deferred |
| FR-2.9b | The chat widget is hidden when chat is disabled or AI setup is incomplete. Operators can still preview its appearance | High | Done |
| FR-2.9c | Operators who can manage the provider see a setup prompt on the dashboard home and Agents pages while the AI provider configuration is missing or unusable, and an error prompt when it cannot be checked | High | Done |

#### 3.2.3 Agent configuration (FR-2c)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.10 | Only the admin can create a new agent with a custom name | Medium | Done |
| FR-2.11 | Operator can set a system prompt that defines the agent's persona, role, and tone for their domain — a single raw prompt field for v1 | High | Done |
| FR-2.12 | Operator can maintain a word blacklist; the agent must not use or engage with blacklisted terms | Medium | Done |
| FR-2.13 | Operator can preview/test the agent via a live chat interface inside the dashboard, without embedding the widget on their site | Medium | In progress |
| FR-2.13a | Operator with agent-deletion permission can delete an agent, permanently removing its conversations, messages, usage, knowledge base, MCP servers, and role grants. Attached embeds block deletion until removed or reassigned; confirmation requires typing the agent name | Medium | Done |

#### 3.2.4 Knowledge base & integrations (FR-2d)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.14 | Operator can upload files (documents) to build a knowledge base that the agent references when responding | High | Done |
| FR-2.15 | Operator can delete files from the knowledge base | Medium | Done |
| FR-2.16 | Operator can crawl site content into the knowledge base on demand, without an MCP server (deferred: input format and storage model undecided) | High | Deferred |
| FR-2.17 | Operator can explicitly configure the provider and embedding model identifier used to index knowledge base content | Medium | Done |
| FR-2.18 | Operator can connect their own MCP server to give the agent access to structured data | High | Done |
| FR-2.19 | Connectivity and tool discovery happen when saving the MCP server: saving connects, fetches the server's tool list, and populates the operator's tool selection. There is no separate test action or stored health; a server whose last save found no tools shows that state, and saving again is the retry | Medium | Done |

#### 3.2.5 Embed appearance (FR-2e)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.20 | Operator can set the embed's light-mode palette (primary, text on primary, background, surface, text) via hex color pickers | Medium | Done |
| FR-2.20a | Operator can set the embed's dark-mode palette independently of light mode, with no color derived or auto-generated from the other | Medium | Done |
| FR-2.21 | Operator can set on the embed whether the widget displays a light/dark mode switch to end users | Low | Done |
| FR-2.22 | Operator can set the embed's display language (currently English, Czech, and Chinese); the dashboard itself is localized into the same set | Low | Done |
| FR-2.23 | Operator can set the embed's avatar image | Low | Not started |
| FR-2.24 | Operator can set the embed's on-page position (e.g. bottom-right, bottom-left) | Low | Done |

#### 3.2.6 Analytics (FR-2f)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.25 | Dashboard displays graphs of token consumption over time | Medium | Done |
| FR-2.26 | Dashboard displays the total number of end-user messages over time | Medium | Done |
| FR-2.27 | Operator can view end-user conversations to assess how the widget is serving end users | High | Done |
| FR-2.28 | Dashboard displays a breakdown of conversation categories (e.g. product inquiries, order issues, returns, general FAQ) | Low | Not started |
| FR-2.29 | Dashboard displays satisfaction rating analytics | Low | Not started |
| FR-2.30 | Dashboard displays general engagement metrics (total conversations, unique chat users, percentage of site visitors who used the widget) | Low | Not started |

### 3.3 Connection SDK (FR-3)

> A headless JS/TS client library that lets developers build a fully custom chat UI against Talqo agent, as an alternative to embedding the pre-built widget. Uses the same API as the widget, so rate limiting (NFR-3.5), input limits (NFR-3.6), and content-policy NFRs (NFR-2) apply to SDK traffic identically, enforced API-side — no separate enforcement needed.

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-3.1 | Developer can send a message to the agent and receive a response via the SDK, without using the pre-built widget UI | High | Done |
| FR-3.2 | SDK supports streaming responses (incremental tokens) so a custom UI can render output as it's generated | High | Done |
| FR-3.3 | SDK manages conversation/session state (create new, resume via session ID), equivalent to what the widget does internally | High | Done |
| FR-3.4 | SDK authenticates using the same public embed token as the pre-built widget — no separate credential type (server-side enforcement: NFR-3.3) | High | Done |
| FR-3.5 | SDK fetches the server-side visual configuration (described in FR-2e) | Medium | Done |

## 4. Non-Functional Requirements

### 4.1 Architecture & Deployment (NFR-1)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-1.1 | The widget must be deployable via a script tag so it can be embedded on any website, including static pages, without requiring a specific framework | Enables integration into any website regardless of tech stack. Related to FR-2.7 | High | In progress (built widget.js self-mounts from a script tag) |
| NFR-1.2 | Operator- and developer-facing documentation (widget integration guide, SDK reference, configuration reference) must be provided | Docs app uses Fumadocs | High | In progress (AI provider configuration reference added) |
| NFR-1.3 | API, dashboard, and widget ship in one container image; docs ships its own image | Orchestration (Compose/Helm/k8s) is `talqo-deploy`'s responsibility, not this repo's | High | In progress |
| NFR-1.3a | Publish versioned Talqo and docs images to GHCR on release | Matching versions; `latest` follows prod deployment | High | Done |
| NFR-1.3b | Publish the SDK with JavaScript and TypeScript declarations to npm on release | Matching release version; trusted publishing | High | Done |
| NFR-1.4 | Product settings (AI provider, agents, embeds) are configured in the dashboard; deployment policy (database, secrets, chat limits, storage paths) is supplied via environment variables | Env vars are validated at startup | High | Done |

### 4.2 Safety & Content Policy (NFR-2)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-2.1 | The agent must refuse requests that could cause real-world harm (e.g. harmful advice, PII extraction) | Enforced via platform system-prompt guardrails (acceptance: committed adversarial test set) | High | In progress (guardrails shipped; adversarial test set pending) |
| NFR-2.2 | Operator-defined word blacklist violations must be filtered **before** the response is sent to the end user | | High | Done |
| NFR-2.3 | The agent must stay on-topic for the operator's domain and refuse to help with unrelated tasks (e.g. homework, general trivia) | Enforced via platform system-prompt guardrails (acceptance: committed adversarial test set) | High | In progress (guardrails shipped; adversarial test set pending) |
| NFR-2.4 | The agent must resist prompt injection attempts that try to override its system prompt, leak blacklisted terms, or trigger unintended MCP tool calls — whether embedded directly in an end-user message or indirectly in ingested knowledge base content | Covers both direct input (FR-1.1) and indirect injection via uploaded files or crawled pages (FR-2.14, FR-2.16) (acceptance: committed adversarial test set) | High | In progress (partial guardrails in platform prompt; adversarial test set pending) |

### 4.3 Security (NFR-3)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-3.1 | The operator's AI provider credentials must be stored encrypted at rest and never exposed to the frontend | | High | Done |
| NFR-3.2 | API endpoints require authentication, except health/infrastructure endpoints (e.g. `/health`) needed for uptime checks | | High | Done |
| NFR-3.3 | SDK and widget endpoints authenticate using an embed's public token | Related to FR-3.4 | High | Done |
| NFR-3.4 | Site crawling must stay within the operator-provided sitemap or URL pattern | Related to FR-2.16 | High | Not started |
| NFR-3.5 | The API enforces a daily question allowance per agent and client network, reset at UTC midnight, plus a per-network concurrency cap | | High | Done |
| NFR-3.6 | The API enforces a limit on the size of assembled model input, default 400,000 Unicode code points; there is no separate per-message limit | | High | Done |
| NFR-3.7 | End-user conversations and usage are retained until the operator deletes the agent (FR-2.13a); per-conversation deletion and export is deferred | | Medium | Done |

### 4.4 Usability (NFR-4)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-4.1 | Widget must be fully responsive and usable across screen sizes, including mobile devices | | High | In progress (panel caps at viewport width) |
| NFR-4.2 | Widget defaults to the end user's system color-scheme preference (light/dark); the operator may override it via configuration | | High | Done |

### 4.5 Test Coverage (NFR-5)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-5.1 | API must have integration tests covering all major modules with mocked external services | Integration tests use real DB; unit tests use in-memory repo | High | In progress (integration tests exist for 9 of 10 modules; usage is the exception) |
| NFR-5.2 | Integration tests must run in CI pipeline on every PR | Separate job; Postgres started via Compose | High | Done |
| NFR-5.3 | Core business logic across API and web apps has unit test coverage | | High | Done |
| NFR-5.4 | Critical user flows are covered by end-to-end (E2E) tests | Playwright suite in `apps/e2e`; not run on PRs | High | Done |
