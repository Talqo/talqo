# AI Provider Configuration Design

## Status

Approved for specification review on 2026-08-20. Implementation is not part of this document.

## Context

Talqo is a single-tenant application in which multiple operator accounts manage one deployment. The SRS requires operators to provide AI credentials through the dashboard, configure an embedding model, and keep provider keys encrypted at rest. The architecture assigns deployment-wide credentials and model selection to an `ai-provider` API module, but that module, its persistence, and its dashboard page do not exist yet.

The first release must support OpenAI, Anthropic, Google Gemini, Mistral, Azure OpenAI, Amazon Bedrock, and OpenAI-compatible endpoints through the Vercel AI SDK. Text generation and embeddings are independent roles because a provider such as Anthropic has no embedding API and operators may prefer different vendors for each workload.

## Goals

- Let authorized operators configure one active text model and one active embedding model for the deployment.
- Make embedding configuration mandatory while avoiding duplicate credential entry when both roles use the same provider account.
- Discover available model identifiers when a provider supports discovery and provide a manual fallback when discovery fails or is unsupported.
- Filter model lists only from explicit, trustworthy provider capability metadata.
- Store spend-capable provider credentials encrypted and never return stored secret values to the web app.
- Keep provider additions localized behind a provider registry and adapter boundary.
- Provide runtime-ready Vercel AI SDK models to future conversation and knowledge modules without exposing persistence or credentials.

## Non-Goals

- Generating chat responses, streaming, RAG ingestion, or embedding documents.
- Proving that an unverified model identifier supports the role selected by an operator.
- Maintaining a Talqo-owned catalog of vendor models or inferring capabilities from model names.
- Supporting multiple active text or embedding configurations, per-agent overrides, failover, routing, or load balancing.
- Building a general-purpose connection catalog or plugin marketplace.
- Calling live provider APIs from automated tests.
- Automating `APP_SECRET` rotation or re-encrypting credentials in this release.

## Chosen Approach

The dashboard uses a role-oriented form with separate Text generation and Embeddings sections. Each role selects a provider, authentication mode, provider settings, credentials, and a model identifier. The embedding role reuses text credentials by default when the same provider and authentication context support embeddings; an operator can instead provide separate credentials or select another provider.

This is preferred over a named connection catalog because Talqo currently needs only two active roles. It is preferred over a primary-provider form with an embedding override because independent providers are a normal configuration rather than an exceptional case.

## Supported Providers

The initial registry contains:

| Provider | Text | Embeddings | Discovery classification |
|---|---:|---:|---|
| OpenAI | Yes | Yes | Model IDs are discoverable; role is unverified |
| Anthropic | Yes | No | All direct-provider models are text models |
| Google Gemini | Yes | Yes | Explicit generation methods permit role filtering |
| Mistral | Yes | Yes | Generation metadata is useful, but embedding classification is not universally reliable |
| Azure OpenAI | Yes | Yes | Filter only when the chosen API returns explicit capabilities; callable identifiers may be deployment names |
| Amazon Bedrock | Yes | Yes | Explicit modality metadata permits coarse role filtering |
| OpenAI-compatible | Yes | Yes | Discovery is optional and roles are unverified |

Named integrations use their official Vercel AI SDK provider packages. Generic endpoints use `@ai-sdk/openai-compatible`. Azure OpenAI and Amazon Bedrock support static credentials and deployment identity through the platform's runtime credential chain. Provider-specific endpoint, region, project, resource, deployment, and API-version settings are exposed only where required.

Mistral remains a named integration because it provides text and embedding models, a documented EU inference endpoint, and paths to private or self-hosted deployment. OpenAI-compatible support covers operator-managed vLLM, NVIDIA NIM, and similar servers without adding a named Talqo adapter for each server.

## Architecture

The API gains an `ai-provider` business module with four internal boundaries:

1. **Provider registry:** Static definitions describe provider IDs, supported roles, authentication modes, required non-secret settings, credential fields, discovery support, and adapter factories.
2. **Configuration service:** Validates and updates the active deployment configuration and exposes runtime text and embedding model factories to other modules.
3. **Discovery service:** Calls vendor discovery APIs server-side and normalizes model identifiers plus optional explicit role metadata.
4. **Credential vault:** Encrypts, decrypts, and redacts provider credentials behind a narrow interface.

Future `conversation` and `knowledge` modules may import only the `ai-provider` service. They do not read its table, decrypt credentials, or instantiate provider packages directly.

The web app owns the route, form workflow, query and mutation state, and permission-gated navigation. The API publishes machine-readable provider metadata such as supported roles, authentication modes, and required field identifiers. The web app maps known provider and field identifiers to literal localized labels so all locale keys remain statically checkable.

Adding a provider requires one registry definition, its adapter, explicit web label mappings, and focused adapter coverage. Shared form behavior does not branch on provider names.

## Dashboard Experience

A new **AI configuration** item appears in desktop and mobile dashboard navigation only for an operator with `ai_provider:manage`. Direct route and API access remain authorization-protected.

The page follows the existing centered page-header and card layout. It contains two ordered cards and one page-level save action.

### Text Generation

The operator selects one of the seven providers and completes its required connection fields. Azure OpenAI and Amazon Bedrock additionally offer deployment identity. Once the required fields are valid, `Load models` sends transient values to the API; when editing, it can instead use the stored credential without returning that credential to the browser.

Successful discovery produces a searchable dropdown. Models whose roles cannot be verified remain selectable and carry an "Unverified capability" explanation. Failed or unsupported discovery preserves the form and reveals the provider error, a retry action, and a manual model-identifier field.

### Embeddings

Embedding configuration is required. If the text provider supports embeddings, the embedding provider defaults to that provider and `Use text provider credentials` defaults on. The operator may disable reuse or select another embedding-capable provider, which reveals separate connection fields. Anthropic and any future text-only provider are excluded from this provider picker.

Discovery and manual fallback match the text section. Where the provider returns explicit capability metadata, the API filters the normalized result to embedding models. Otherwise the dropdown remains unfiltered and clearly unverified.

### Editing And Saving

- Changing a provider clears only its incompatible unsaved model selection.
- Existing secrets appear as `Configured` with an explicit replacement action. Empty secret inputs never erase stored values.
- Save is disabled until both roles have an authentication source and a non-empty model or deployment identifier.
- Discovery is attempted for convenience but does not need to succeed before save.
- Saving both roles is atomic.
- Success, field validation, discovery errors, and save errors are announced accessibly and shown next to the affected scope.
- The cards retain their order and stack on narrow viewports.

## Model Discovery Policy

The Vercel AI SDK constructs runtime model clients but is not treated as a model-discovery API. Each provider adapter calls the relevant vendor endpoint and returns a normalized result:

```text
id: string
supportedRoles?: ("text" | "embedding")[]
```

`supportedRoles` is populated only from an explicit provider field whose semantics identify the callable role. Google Gemini generation methods and Amazon Bedrock modalities qualify. Azure data qualifies only on discovery surfaces that return explicit capabilities. Missing metadata means unknown, not unsupported.

Talqo does not classify from identifiers containing words such as `embed`, `chat`, or `instruct`, and it does not maintain a model allowlist. This avoids stale catalogs and false confidence as providers change. The operator owns the choice of an unverified model; downstream runtime failures must report that provider error clearly when text generation or RAG is implemented.

## Persistence

`AI_PROVIDER_CONFIG` is a singleton deployment-level record containing:

- text provider ID, model identifier, authentication mode, validated non-secret settings, and encrypted credentials when static authentication is used;
- embedding provider ID, model identifier, validated non-secret settings, and one credential source: reused text credentials, separate encrypted credentials, or deployment identity;
- a revision used for optimistic concurrency; and
- creation and update timestamps.

Provider settings and credentials are structured and validated against the selected registry definition. Credentials are not mixed into non-secret JSON.

Credential reuse is valid only when both roles use the same provider and compatible authentication context. Changing the text provider cannot leave an embedding role referencing incompatible text credentials; the whole update is rejected.

## Credential Security

Provider credentials are encrypted with authenticated encryption using a random nonce and a key derived from the deployment's general `APP_SECRET` under an AI-credential-specific context. The stored envelope is versioned so its format can evolve. Plaintext exists only while processing a request, performing discovery, or constructing a runtime provider instance; it is not logged or cached.

Field encryption protects database-only leaks such as exposed backups, snapshots, exports, read replicas, or SQL credentials. It does not protect against compromise of the API process, deployment environment, or a fully privileged host administrator because those actors can access `APP_SECRET`. This limited threat model and the requirement to back up `APP_SECRET` must be documented.

The API validates a sufficiently strong `APP_SECRET` at startup. If it changes, existing provider credentials become unusable and authorized operators must replace them. Automated key rotation and previous-key support are outside this release.

Read responses expose authentication mode and whether a stored credential exists, but never ciphertext, nonces, secret values, or reversible masks.

## Authorization

The roles module gains `ai_provider:manage`. The sole deployment admin receives it by default and may grant it to other operators through the existing permission model. Operators without it do not see the navigation item. All provider metadata, configuration, discovery, and update routes enforce the permission independently of the UI.

This permission is highly privileged because it grants access to spend-capable credentials and allows the API process to contact configured endpoints.

## API Operations And Data Flow

The module provides authenticated operations to:

- read supported-provider metadata;
- read the redacted active configuration;
- discover models using transient form credentials, deployment identity, or an existing stored credential; and
- atomically replace the active configuration using its last-read revision.

Discovery never mutates saved configuration. Static credentials supplied for discovery remain transient unless a later update explicitly saves them.

An update validates provider IDs, role support, authentication modes, required settings, credential sources, and non-empty model identifiers. It does not require a successful model-list request and does not claim that an unverified identifier supports the selected role.

The service decrypts credentials only when a future consumer asks it for a configured Vercel AI SDK model. Consumers receive the appropriate SDK model interface, not provider settings or plaintext credentials.

## OpenAI-Compatible Endpoint Policy

Operators with `ai_provider:manage` may configure arbitrary public, private, local, HTTP, or HTTPS OpenAI-compatible endpoints. This intentionally permits API-server network reach needed by private vLLM and similar deployments and consequently creates SSRF-like capability for those operators.

The adapter rejects non-HTTP protocols, applies strict connection and response timeouts and response-size limits, sanitizes returned errors, and never forwards credentials across a cross-origin redirect. It does not block private, loopback, or link-local addresses. Deployment documentation must make this trust decision explicit.

## Errors And Concurrency

Discovery errors are normalized as unauthorized, unreachable, rate-limited, unsupported discovery, or provider error. Raw provider responses, authorization headers, and credentials are excluded from logs and client errors. A failure preserves form state and enables retry or manual identifier entry.

Updates use optimistic concurrency. The client submits the revision it read; if another operator has saved a newer configuration, the API rejects the stale update. The page preserves local edits and instructs the operator to reload before retrying rather than silently overwriting the newer configuration.

Invalid stored schema, failed decryption, or missing runtime identity marks the configuration unusable. Redacted reads may expose a safe configuration-health state but no underlying secret or cryptographic detail.

## Durable Test Strategy

Tests target stable security and behavior boundaries rather than markup or vendor catalog details:

- Service tests cover both required roles, provider-role compatibility, credential reuse, redacted reads, revision conflicts, normalized discovery outcomes, and rejection of unusable or tampered encrypted credentials.
- Provider adapter contract tests use fixed mocked responses to verify normalized identifiers and explicit roles, unsupported discovery, and secret-safe failures. They do not snapshot complete requests or model catalogs.
- PostgreSQL integration tests verify that plaintext credentials are absent from stored data, updates are atomic, and stale revisions cannot overwrite newer configuration.
- Route tests verify authentication, `ai_provider:manage`, malformed input, and absence of secrets from redacted and unauthorized responses.
- Two end-to-end journeys cover a granted operator saving separate text and embedding providers and reloading redacted state, plus an ungranted operator being unable to see or access the page. Provider behavior comes from one controlled fake service.

Validation, manual fallback, credential reuse, and accessible feedback are exercised within those journeys where natural. The suite does not assert card markup, CSS, translated wording, complete provider catalogs, exact ciphertext bytes, SDK internals, or every transient loading state.

## Documentation And Architectural Follow-Up

Implementation must:

- add an ADR for adopting the Vercel AI SDK and provider-adapter strategy;
- update `docs/architecture.md` and the module diagram if the implemented boundary differs from the current canonical structure;
- update the SRS completion state without changing the requirement that credentials are encrypted at rest;
- document `APP_SECRET`, its loss behavior, static credentials, deployment identity, model discovery limitations, and the OpenAI-compatible endpoint trust model; and
- update all web locale files together with identical key sets and literal translation-key calls.

## Success Criteria

- A granted operator can save and later edit one required text and one required embedding configuration.
- The two roles can use different providers or safely reuse one compatible credential source.
- Discoverable models appear in searchable dropdowns, explicit capability metadata is respected, and unsupported or failed discovery permits manual identifiers.
- OpenAI, Anthropic, Google Gemini, Mistral, Azure OpenAI, Amazon Bedrock, and OpenAI-compatible configurations produce the appropriate Vercel AI SDK model interfaces.
- Stored and returned data never contain plaintext provider credentials.
- Unauthorized operators cannot discover models, read configuration metadata, update configuration, or access the dashboard page.
- Concurrent edits cannot silently overwrite each other.
