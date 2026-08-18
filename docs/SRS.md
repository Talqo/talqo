# Software Requirements Specification

## 1. Introduction

### 1.1 Purpose

This document specifies the functional and non-functional requirements for **Talqo**, an open-source, self-hosted AI chat agent that operators embed on their own websites.

### 1.2 Scope

Talqo covers the embeddable widget, the operator dashboard, and the connection SDK, packaged as a single self-hosted deployment. It does not cover deployment orchestration or multi-tenant hosting, billing, or back-office tooling.

### 1.3 Definitions & Acronyms

| Term | Meaning |
|------|---------|
| Agent | The configured AI persona (system prompt, blacklist, knowledge base, MCP tools) that answers end users; a deployment may run multiple agents |
| MCP | Model Context Protocol — lets the agent call external tools/structured data sources |
| RAG | Retrieval-Augmented Generation — extracts relevant context from the knowledge base when responding to end user |
| SDK | The headless connection SDK (FR-3) |
| Widget | The pre-built, embeddable chat UI (FR-1) |
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
- Dashboard accounts are role-based: exactly one admin account exists per deployment, created via first-run setup (FR-2.1). The admin can assign granular permissions to other registered accounts. There is no superadmin.
- The operator must supply their own AI provider API key; there is no platform-funded default key.

### 2.4 Assumptions & Dependencies

- `talqo-deploy` is expected to consume the container images `talqo` publishes (NFR-1.3a) — `talqo` does not need to provide its own orchestration.
- An external database is available at deploy time; PostgreSQL is not required, but the
  database must support vector similarity search for knowledge-base embeddings (FR-2.17).
- The operator has baseline familiarity with Docker and environment-variable configuration.
- Uploaded knowledge-base files (FR-2.14) are stored on the local filesystem.

## 3. Functional Requirements

### 3.1 Widget (FR-1)

> The embeddable chat widget rendered on the operator's website for end users.

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-1.1 | End user can send text messages to the agent and receive AI-generated responses (rendered as markdown) | High | Not started |
| FR-1.2 | Conversation history is persisted server-side and survives page reloads via browser session ID | High | Not started |
| FR-1.3 | Widget can be minimized and reopened without losing the conversation state | High | In progress (minimize/reopen keeps session state; reload persistence pending) |
| FR-1.4 | Widget displays a typing indicator while the agent is generating a response | High | Not started |
| FR-1.5 | End user can reset the current conversation, which starts a new chat session | Medium | Not started |
| FR-1.6 | End user can rate individual agent responses with a thumbs up / thumbs down | Low | Not started |
| FR-1.7 | Widget can be resized by the end user on desktop (not available on mobile viewports) | Low | Not started |

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
| FR-2.7 | Operator can embed the widget on their website via a script tag (framework-independence constraint: NFR-1.1) | High | In progress (script-tag snippet; origin via VITE_WIDGET_CDN_URL) |
| FR-2.8 | Operator can rotate the widget's public token to invalidate the old embed code | Medium | Not started |

#### 3.2.2 API configuration (FR-2b)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.9 | Operator must configure their own AI provider API endpoint and API key before the agent can respond to end users | High | Not started |
| FR-2.9a | Operator can set a maximum token usage limit per period (day/month); once reached, the agent stops responding to end users until the operator raises the limit or the period resets | High | Not started |

#### 3.2.3 Agent configuration (FR-2c)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.10 | Operator can create a new agent with custom name | Medium | Done (API + dashboard) |
| FR-2.11 | Operator can set a system prompt that defines the agent's persona, role, and tone for their domain — a single raw prompt field for v1 | High | Done (single raw prompt field, per v1) |
| FR-2.12 | Operator can maintain a word blacklist; the agent must not use or engage with blacklisted terms | Medium | In progress (API + dashboard; runtime enforcement pending) |
| FR-2.13 | Operator can preview/test the agent via a live chat interface inside the dashboard, without embedding the widget on their site | Medium | In progress (live widget-shell preview; no AI responses) |
| FR-2.13a | Operator can delete an agent | Medium | In progress (API endpoint done, incl. removal of the agent's uploaded files from disk; dashboard delete control pending) |

#### 3.2.4 Knowledge base & integrations (FR-2d)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.14 | Operator can upload files (documents) to build a knowledge base that the agent references when responding | High | In progress (upload done: PDF/TXT/MD/DOCX up to 10 MB, stored on the local filesystem; embedding and chat-time retrieval pending) |
| FR-2.15 | Operator can delete files from the knowledge base | Medium | Done |
| FR-2.16 | Operator can provide their website's sitemap (format TBA, e.g. `sitemap.xml`) or a URL pattern to crawl site content into the knowledge base on demand — no MCP server required | High | Not started |
| FR-2.17 | Operator can configure the embedding model used to index knowledge base content (with provider-specific defaults) | Medium | Not started |
| FR-2.18 | Operator can connect their own MCP server to give the agent access to structured data | High | Not started |
| FR-2.19 | Operator can verify MCP server connectivity and view available tools before or after enabling | Medium | Not started |

#### 3.2.5 Widget appearance (FR-2e)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.20 | Operator can set the widget's accent color via a hex color picker | Medium | In progress (hex picker wired to embed; not persisted) |
| FR-2.21 | Operator can toggle whether the widget displays a light/dark mode switch to end users | Low | Not started |
| FR-2.22 | Operator can set the widget's display language | Low | In progress (embed setting; separate from operator UI language) |
| FR-2.23 | Operator can set the agent's avatar image | Low | Not started |
| FR-2.24 | Operator can set the widget's on-page position (e.g. bottom-right, bottom-left) | Low | In progress (bottom-right/bottom-left wired to embed) |

#### 3.2.6 Analytics (FR-2f)

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-2.25 | Dashboard displays graphs of token consumption over time | Medium | In progress (mock statistics) |
| FR-2.26 | Dashboard displays the total number of end-user questions over time | Medium | In progress (mock statistics; charts total messages) |
| FR-2.27 | Operator can view end-user conversations to assess how the widget is serving end users | High | Not started |
| FR-2.28 | Dashboard displays a breakdown of conversation categories (e.g. product inquiries, order issues, returns, general FAQ) | Low | Not started |
| FR-2.29 | Dashboard displays satisfaction rating analytics | Low | Not started |
| FR-2.30 | Dashboard displays general engagement metrics (total conversations, unique chat users, percentage of site visitors who used the widget) | Low | Not started |

### 3.3 Connection SDK (FR-3)

> A headless JS/TS client library that lets developers build a fully custom chat UI against Talqo agent, as an alternative to embedding the pre-built widget. Uses the same backend as the widget, so rate limiting (NFR-3.5), message limits (NFR-3.6), and content-policy NFRs (NFR-2) apply automatically to SDK-originated traffic — no separate enforcement needed.

| ID | Requirement | Priority | Completion |
|----|-------------|----------|------------|
| FR-3.1 | Developer can send a message to the agent and receive a response via the SDK, without using the pre-built widget UI | High | Not started |
| FR-3.2 | SDK supports streaming responses (incremental tokens) so a custom UI can render output as it's generated | High | Not started |
| FR-3.3 | SDK manages conversation/session state (create new, resume via session ID), equivalent to what the widget does internally | High | Not started |
| FR-3.4 | SDK authenticates using the same public widget token as the pre-built widget — no separate credential type (server-side enforcement: NFR-3.3) | High | Not started |
| FR-3.5 | SDK fetches the server-side visual configuration (described in FR-2e) | Medium | Not started |

## 4. Non-Functional Requirements

### 4.1 Architecture & Deployment (NFR-1)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-1.1 | The widget must be deployable via a script tag so it can be embedded on any website, including static pages, without requiring a specific framework | Enables integration into any website regardless of tech stack. Related to FR-2.7 | High | In progress (built widget.js self-mounts from a script tag) |
| NFR-1.2 | Operator- and developer-facing documentation (widget integration guide, SDK reference, configuration reference) must be provided | Docs app is expected to use a documentation framework (fumadocs is the leading candidate) | High | Not started |
| NFR-1.3 | Each deployable component (API, dashboard, docs) ships a working Dockerfile producing a runnable container image | Deployment orchestration (Compose/Helm/k8s) is `talqo-deploy`'s responsibility, not this repo's | High | Not started |
| NFR-1.3a | The CD pipeline builds and publishes tagged images for each component to a public container registry (e.g. `ghcr.io/talqo/*`) on release | Lets `talqo-deploy`'s recipes reference a pre-built image instead of building from source | High | Not started |
| NFR-1.3b | The CD pipeline publishes the connection SDK — installable TypeScript package to the npm registry on release | Same release-automation treatment as NFR-1.3a's image publishing — the SDK isn't usable by developers if it only exists as source | High | Not started |
| NFR-1.4 | Operator-configurable settings (AI provider key, agent configuration, etc.) are supplied through the dashboard web interface after deployment | The database connection — including a randomly-generated password — is supplied via environment variables at deploy time, validated at startup, failing fast if missing or invalid | High | Not started |

### 4.2 Safety & Content Policy (NFR-2)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-2.1 | The agent must refuse requests that could cause real-world harm (e.g. harmful advice, PII extraction) | Enforced via system prompt guardrails | High | Not started |
| NFR-2.2 | Operator-defined word blacklist violations must be filtered **before** the response is sent to the end user | | High | Not started |
| NFR-2.3 | The agent must stay on-topic for the operator's domain and refuse to help with unrelated tasks (e.g. homework, general trivia) | Enforced via system prompt guardrails | High | Not started |
| NFR-2.4 | The agent must resist prompt injection attempts that try to override its system prompt, leak blacklisted terms, or trigger unintended MCP tool calls — whether embedded directly in an end-user message or indirectly in ingested knowledge base content | Covers both direct input (FR-1.1) and indirect injection via uploaded files or crawled pages (FR-2.14, FR-2.16) reaching the agent as context | High | Not started |

### 4.3 Security (NFR-3)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-3.1 | The operator's AI provider API key must be stored encrypted at rest and never exposed to the frontend | | High | Not started |
| NFR-3.2 | API endpoints require authentication, except health/infrastructure endpoints (e.g. `/health`) needed for uptime checks | | High | Not started |
| NFR-3.3 | SDK and widget endpoints authenticate using the instance's public token | Related to FR-3.4 | High | Not started |
| NFR-3.4 | Site crawling must stay within the operator-provided sitemap or URL pattern | Related to FR-2.16 | High | Not started |
| NFR-3.5 | Widget enforces IP-based rate limiting to prevent abuse | | High | Not started |
| NFR-3.6 | Widget enforces a per-conversation message limit | | High | Not started |

### 4.4 Usability (NFR-4)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-4.1 | Widget must be fully responsive and usable across screen sizes, including mobile devices | | High | In progress (panel caps at viewport width) |
| NFR-4.2 | Widget defaults to the end user's system color-scheme preference (light/dark); the operator may override it via configuration | | High | In progress (system default + data-talqo-theme override) |

### 4.5 Test Coverage (NFR-5)

| ID | Requirement | Notes | Priority | Completion |
|----|-------------|-------|----------|------------|
| NFR-5.1 | API must have integration tests covering all major modules with mocked external services | Integration tests use real DB; unit tests use in-memory repo | High | Not started |
| NFR-5.2 | Integration tests must run in CI pipeline on every PR | Separate job with a database service | High | Not started |
| NFR-5.3 | Core business logic across API and web apps has unit test coverage | | High | Not started |
| NFR-5.4 | Critical user flows are covered by end-to-end (E2E) tests | | High | Not started |
