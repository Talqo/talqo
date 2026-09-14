# Software Requirements Specification

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for **Talqo**, an open-source, self-hosted AI chat agent that operators embed on their own websites.

### 1.2 Scope

Talqo covers the embeddable widget, the operator dashboard, and the connection SDK, packaged as a single self-hosted deployment. It does not cover deployment orchestration or multi-tenant hosting, billing, or back-office tooling.

### 1.3 Definitions & Acronyms

| Term | Meaning |
|------|---------|
| Agent | The configured AI identity, system prompt, and output blacklist that answers end users; a deployment may run multiple agents |
| Embed | A public integration configuration that selects one agent, owns appearance and a rotatable public token, and carries an access version |
| Conversation session | The private bearer-authorized browser session that owns exactly one conversation |
| MCP | Model Context Protocol — lets the agent call external tools/structured data sources |
| RAG | Retrieval-Augmented Generation — extracts relevant context from the knowledge base when responding to end user |
| SDK | The headless connection SDK (FR-3) |
| Widget | The pre-built, embeddable chat UI (FR-1) |
| Knowledge base | Uploaded content stored for future retrieval features; current end-user chat does not add it to model input |

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
- Dashboard accounts are role-based: exactly one admin account exists per deployment, created via first-run setup (FR-2.1). The admin can assign granular permissions to other registered accounts. There is no superadmin.
- The operator must supply their own AI provider authentication source; there is no platform-funded default.

### 2.4 Assumptions & Dependencies

- `talqo-deploy` is expected to consume the container images `talqo` publishes (NFR-1.3a) — `talqo` does not need to provide its own orchestration.
- PostgreSQL is available at deploy time and provides the authoritative relational datastore and vector similarity support for knowledge-base embeddings (FR-2.17).
- The operator has baseline familiarity with Docker and environment-variable configuration.
- Uploaded knowledge-base files (FR-2.14) are stored on the local filesystem.

## 3. Functional Requirements

### 3.1 Widget (FR-1)

> The embeddable chat widget rendered on the operator's website for end users.

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-1.1 | End user can send text messages and receive incrementally streamed AI responses | High | Done |
| FR-1.2 | Conversation history is retained server-side and restored with a private bearer session credential | High | Done |
| FR-1.3 | Widget can be minimized and reopened without losing conversation state | High | Done |
| FR-1.4 | Widget shows generation and recovery state while the agent is responding | High | Done |
| FR-1.5 | End user can start a new chat; this detaches the browser from the retained old conversation without resetting network allowance | Medium | Done |
| FR-1.6 | End user can rate individual agent responses with a thumbs up / thumbs down | Low | Not started |
| FR-1.7 | Widget can be resized by the end user on desktop (not available on mobile viewports) | Low | Done |

### 3.2 Dashboard (FR-2)

> The web application where the operator configures the agent and monitors usage.

#### 3.2.1 Operator account & access (FR-2a)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.1 | On first deployment run, the operator is redirected to an admin setup page and must create the sole admin account before the dashboard becomes otherwise usable | High | Done |
| FR-2.2 | Operator can register a new operator user account | High | Done |
| FR-2.3 | Operator can log in and log out of the dashboard | High | Done |
| FR-2.3a | Operator can log in via SSO (e.g. Google) as an alternative to username/password credentials | Medium | Not started |
| FR-2.4 | Operator can change their account password | Medium | Done |
| FR-2.4a | Admin can reset another operator account's password (no self-service password recovery exists, since there is no self-registration or email flow) | Medium | Done |
| FR-2.5 | Operator can update their account information (username) | Medium | Done |
| FR-2.6 | Operator can delete their account | Medium | Done |
| FR-2.7 | Operator can embed the widget on their website via a script tag (framework-independence constraint: NFR-1.1) | High | Done |
| FR-2.8 | Operator can rotate an embed's public token, which immediately invalidates the old token and increments its access version | Medium | Done |

#### 3.2.2 API configuration (FR-2b)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.9 | An authorized operator must configure the text provider, endpoint, authentication source, and model identifier before the agent can respond; embedding configuration is independent of chat | High | Done |
| FR-2.9a | Talqo enforces a deployment-configured daily accepted-question allowance independently for each agent and normalized client network; there is no daily/monthly token cap or deployment-wide consumption quota | High | Done |

#### 3.2.3 Agent configuration (FR-2c)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.10 | Operator can create a new agent with custom name | Medium | Done |
| FR-2.11 | Operator can set a system prompt that defines the agent's persona, role, and tone for their domain — a single raw prompt field for v1 | High | Done |
| FR-2.12 | Operator can maintain a literal, case-insensitive output blacklist; matching generation is stopped and marked blocked | Medium | Done |
| FR-2.13 | Operator can preview/test the agent via a live chat interface inside the dashboard, without embedding the widget on their site | Medium | In progress |
| FR-2.13a | Operator can delete an agent after removing or reassigning attached embeds; deletion permanently cascades retained conversations, sessions, attempts, messages, counters, and usage | Medium | Done |

#### 3.2.4 Knowledge base & integrations (FR-2d)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.14 | Operator can upload files to build a knowledge base for future retrieval; current end-user chat does not read it | High | In progress |
| FR-2.15 | Operator can delete files from the knowledge base | Medium | Done |
| FR-2.16 | Operator can provide a website sitemap or URL pattern to crawl site content into the knowledge base on demand; this future ingestion capability is independent of MCP | High | Not started |
| FR-2.17 | Operator can explicitly configure the provider and embedding model identifier used to index knowledge base content | Medium | Done |
| FR-2.18 | Operator can connect their own MCP server to give the agent access to structured data | High | Not started |
| FR-2.19 | Operator can verify MCP server connectivity and view available tools before or after enabling | Medium | Not started |

#### 3.2.5 Widget appearance (FR-2e)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.20 | Operator can set the widget's light-mode palette (primary, text on primary, background, surface, text) via hex color pickers | Medium | Done |
| FR-2.20a | Operator can set the widget's dark-mode palette independently of light mode, with no color derived or auto-generated from the other | Medium | Done |
| FR-2.21 | Operator can toggle whether the widget displays a light/dark mode switch to end users | Low | Done |
| FR-2.22 | Operator can set the widget's display language | Low | Done |
| FR-2.23 | Operator can set the agent's avatar image | Low | Not started |
| FR-2.24 | Operator can set the widget's on-page position (e.g. bottom-right, bottom-left) | Low | Done |

#### 3.2.6 Analytics (FR-2f)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.25 | Dashboard displays graphs of token consumption over time | Medium | In progress (mock statistics) |
| FR-2.25a | API persists one unified input/output usage record per actual model-call attempt, using provider counts when valid and approximation for a missing side | Medium | Done |
| FR-2.26 | Dashboard displays the total number of end-user questions over time | Medium | In progress (mock statistics; charts total messages) |
| FR-2.27 | Operator can view end-user conversations to assess how the widget is serving end users | High | Not started |
| FR-2.28 | Dashboard displays a breakdown of conversation categories (e.g. product inquiries, order issues, returns, general FAQ) | Low | Not started |
| FR-2.29 | Dashboard displays satisfaction rating analytics | Low | Not started |
| FR-2.30 | Dashboard displays general engagement metrics (total conversations, unique chat users, percentage of site visitors who used the widget) | Low | Not started |

### 3.3 Connection SDK (FR-3)

> A headless JS/TS client library that lets developers build a fully custom chat UI against Talqo agent, as an alternative to embedding the pre-built widget. Uses the same backend as the widget, so rate limiting (NFR-3.5), message limits (NFR-3.6), and content-policy NFRs (NFR-2) apply automatically to SDK-originated traffic — no separate enforcement needed.

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-3.1 | Developer can send messages through a framework-independent observable chat client without using the pre-built widget UI | High | Done |
| FR-3.2 | SDK parses versioned SSE from POST fetch responses and exposes incrementally updated assistant messages | High | Done |
| FR-3.3 | SDK owns one-conversation bearer persistence, history restoration, cancellation, new-chat behavior, and bounded recovery | High | Done |
| FR-3.4 | SDK uses the embed token to select an integration and a private UUID bearer credential for chat operations | High | Done |
| FR-3.5 | SDK loads server-side embed appearance and exposes it in its observable snapshot | Medium | Done |

## 4. Non-Functional Requirements

### 4.1 Architecture & Deployment (NFR-1)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-1.1 | The widget must be deployable via a script tag so it can be embedded on any website, including static pages, without requiring a specific framework | Enables integration into any website regardless of tech stack. Related to FR-2.7 | High | Done |
| NFR-1.2 | Operator- and developer-facing documentation covers embed/widget integration, SDK lifecycle, chat policy, and deployment configuration | Docs app uses Fumadocs | High | Done |
| NFR-1.3 | Each deployable component (API, dashboard, docs) ships a working Dockerfile producing a runnable container image | Deployment orchestration (Compose/Helm/k8s) is `talqo-deploy`'s responsibility, not this repo's | High | Not started |
| NFR-1.3a | The CD pipeline builds and publishes tagged images for each component to a public container registry (e.g. `ghcr.io/talqo/*`) on release | Lets `talqo-deploy`'s recipes reference a pre-built image instead of building from source | High | Not started |
| NFR-1.3b | The connection SDK remains a private workspace package; npm publication is outside current scope and requires a separate release decision | Public documentation must not present an npm install path | Medium | Done |
| NFR-1.4 | Operator-configurable settings (AI provider key, agent configuration, etc.) are supplied through the dashboard web interface after deployment | The database connection and `APP_SECRET` are supplied via environment variables at deploy time and validated at startup | High | In progress (AI provider configuration done) |

### 4.2 Safety & Content Policy (NFR-2)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-2.1 | The agent must refuse requests that could cause real-world harm (e.g. harmful advice, PII extraction) | Enforced via system prompt guardrails | High | Not started |
| NFR-2.2 | Literal operator-defined blacklist matches must be detected across stream chunks; matching output is blocked, while already emitted safe text cannot be recalled | This is not semantic moderation | High | Done |
| NFR-2.3 | The agent must stay on-topic for the operator's domain and refuse to help with unrelated tasks (e.g. homework, general trivia) | Enforced via system prompt guardrails | High | Not started |
| NFR-2.4 | Current chat must not expose authoritative history/system-instruction fields or execute retrieval and MCP tools; future retrieval/tool scope requires a separate prompt-injection threat model | Current text chat provides no general prompt-injection-immunity guarantee | High | Done |

### 4.3 Security (NFR-3)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-3.1 | The operator's AI provider credentials must be stored encrypted at rest and never exposed to the frontend | | High | Done |
| NFR-3.2 | Operator endpoints require login; public health and embed configuration are explicit exceptions, while chat session operations require a private bearer credential | | High | Done |
| NFR-3.3 | Public callers identify an integration using an embed token and cannot select an agent; rotation, reassignment, or deletion revokes sessions through embed `accessVersion` without deleting history | Related to FR-3.4 | High | Done |
| NFR-3.4 | Site crawling must stay within the operator-provided sitemap or URL pattern | Related to FR-2.16 | High | Not started |
| NFR-3.5 | API atomically enforces daily accepted questions and concurrent generations per agent and normalized client network using PostgreSQL | This is shared-network abuse control, not unique-person identification or DDoS protection | High | Done |
| NFR-3.6 | API rejects complete model input above the configured Unicode code-point bound and never silently truncates or summarizes retained history | Applies to system prompt, all completed pairs, and the current message | High | Done |
| NFR-3.7 | Conversations and usage have no automatic expiry; embed lifecycle changes revoke access but retain data, while agent deletion permanently cascades all associated chat and usage data | Starting a new chat does not delete the old conversation | High | Done |

### 4.4 Usability (NFR-4)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-4.1 | Widget must be fully responsive and usable across screen sizes, including mobile devices | | High | In progress (panel caps at viewport width) |
| NFR-4.2 | Widget defaults to the end user's system color-scheme preference (light/dark); the operator may override it via configuration | | High | Done |

### 4.5 Test Coverage (NFR-5)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-5.1 | API must have integration tests covering all major modules with mocked external services | Integration tests use real DB; unit tests use in-memory repo | High | Not started |
| NFR-5.2 | Integration tests must run in CI pipeline on every PR | Separate job with a database service | High | Not started |
| NFR-5.3 | Core business logic across API and web apps has unit test coverage | | High | Not started |
| NFR-5.4 | Critical user flows are covered by end-to-end (E2E) tests | | High | Not started |
