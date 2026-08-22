# AI Provider Configuration Design

## Status

Approved for specification review on 2026-08-20. Implementation is not part of this document.

## Context

Talqo is a single-tenant application in which multiple operator accounts manage one deployment. The SRS requires operators to provide AI credentials through the dashboard, configure an embedding model, and keep provider keys encrypted at rest. The architecture module diagram assigns deployment-wide credentials and model selection to an `ai-provider` API module, but that module, its persistence, and its dashboard page do not exist yet.

The completed capability must support OpenAI, Anthropic, Google Gemini, Mistral, Azure OpenAI, Amazon Bedrock, and OpenAI-compatible endpoints through the Vercel AI SDK. Text generation and embeddings are independent roles because a provider such as Anthropic has no embedding API and operators may prefer different vendors for each workload.

## Goals

- Let authorized operators configure one active text model and one active embedding model for the deployment.
- Make embedding configuration mandatory while avoiding duplicate credential entry when both roles use the same provider account.
- Discover available model identifiers when a provider supports discovery and provide a manual fallback when discovery fails or is unsupported.
- Store spend-capable provider credentials encrypted and never return stored secret values to the web app.
- Keep provider additions localized behind a provider registry and adapter boundary.
- Construct the selected models through the appropriate Vercel AI SDK provider adapters.

## Chosen Approach

The dashboard uses a role-oriented form with separate Text generation and Embeddings sections. Each role selects a provider, authentication mode, provider settings, credentials, and a model identifier. The embedding role reuses text credentials by default when the same provider and authentication context support embeddings; an operator can instead provide separate credentials or select another provider.

## Supported Providers

The completed registry contains:

| Provider | Text | Embeddings |
|---|---:|---:|
| OpenAI | Yes | Yes |
| Anthropic | Yes | No |
| Google Gemini | Yes | Yes |
| Mistral | Yes | Yes |
| Azure OpenAI | Yes | Yes |
| Amazon Bedrock | Yes | Yes |
| OpenAI-compatible | Yes | Yes |

Named integrations use their official Vercel AI SDK provider packages. Generic endpoints use `@ai-sdk/openai-compatible`. Azure OpenAI and Amazon Bedrock support static credentials and deployment identity through server-side Azure and AWS credential chains, including temporary-token refresh. Provider-specific endpoint, region, project, resource, and API-version settings are exposed only where required. For Azure, the common model-identifier control is labeled **Deployment name** and is the only persisted callable deployment identifier.

Mistral remains a named integration because it provides text and embedding models and a documented EU inference endpoint. OpenAI-compatible support covers operator-managed vLLM, NVIDIA NIM, and similar servers without adding a named Talqo adapter for each server.

## Architecture

The API gains an `ai-provider` business module with four internal boundaries:

1. **Provider registry:** Static definitions describe provider IDs, supported roles, authentication modes, required non-secret settings, credential fields, discovery support, and adapter factories.
2. **Configuration service:** Validates and updates the active deployment configuration and exposes runtime text and embedding model factories to other modules.
3. **Discovery service:** Calls vendor discovery APIs server-side and normalizes model identifiers.
4. **Credential vault:** Encrypts, decrypts, and redacts provider credentials behind a narrow interface.

The web app owns the route, form workflow, query and mutation state, and permission-gated navigation. The API publishes machine-readable provider metadata such as supported roles, authentication modes, and required field identifiers. The web app maps known provider and field identifiers to literal localized labels so all locale keys remain statically checkable.

Adding a provider requires one registry definition, its adapter, explicit web label mappings, and focused adapter coverage. Shared form behavior does not branch on provider names.

## Dashboard Experience

A new **AI configuration** item appears in desktop and mobile dashboard navigation only for an operator with `ai_provider:manage`. Direct route and API access remain authorization-protected.

The page follows the existing centered page-header and card layout. It contains two ordered cards and one page-level save action.

### Text Generation

The operator selects one of the seven providers and completes its required connection fields. Azure OpenAI and Amazon Bedrock additionally offer deployment identity. Once the required fields are valid, `Load models` sends transient values to the API; when editing, it can instead use the stored credential without returning that credential to the browser.

Successful discovery produces a searchable dropdown containing the model identifiers returned by the provider. Failed or unsupported discovery, or an empty result, preserves the form and reveals the provider error or empty result, a retry action, and a manual model-identifier field.

### Embeddings

Embedding configuration is required. If the text provider supports embeddings, the embedding provider defaults to that provider and `Use text provider credentials` defaults on. The operator may disable reuse or select another embedding-capable provider, which reveals separate connection fields. The embedding provider picker contains only registry entries that support embeddings, which excludes Anthropic.

Discovery and manual fallback match the text section. Talqo does not filter the provider's returned model identifiers by model type; the operator is responsible for selecting an embedding-capable model.

### Editing And Saving

- Changing a provider clears that role's model selection, provider-specific settings, transient credentials, and authentication mode before showing the new provider's defaults. Changing authentication mode clears transient credentials and settings that are not valid in the new mode. The other role is preserved unless it reuses the changed text authentication context, in which case it becomes invalid until corrected.
- Existing secrets appear as `Configured` with an explicit replacement action. An omitted secret preserves the stored value only while provider, authentication mode, and authentication context are unchanged. Saving a changed context atomically deletes the superseded encrypted credential.
- Save is disabled until both roles have an authentication source and a non-empty model or deployment identifier.
- Discovery is attempted for convenience but does not need to succeed before save.
- Saving both roles is atomic.
- Success, field validation, discovery errors, and save errors are announced accessibly and shown next to the affected scope.
- The cards retain their order and stack on narrow viewports.

## Model Discovery

The Vercel AI SDK constructs model clients but does not provide model discovery. Each provider adapter calls the vendor's model-list endpoint and returns model identifiers without classifying them as text or embedding models. Adapters exhaust documented pagination before presenting a successful list. Manual entry appears only when discovery is unsupported, fails, or returns an empty list; successful non-empty discovery remains a dropdown-only path.

## Persistence

`AI_PROVIDER_CONFIG` is a singleton deployment-level record containing:

- text provider ID, model identifier, authentication mode, validated non-secret settings, and encrypted credentials when static authentication is used;
- embedding provider ID, model identifier, authentication mode, validated non-secret settings, and one credential source: reused text credentials, separate encrypted credentials, or deployment identity;
- a revision used for optimistic concurrency; and
- creation and update timestamps.

Provider settings and credentials are structured and validated against the selected registry definition. Credentials are not mixed into non-secret JSON.

Credential reuse is valid only when both roles use the same provider and compatible authentication context. Changing the text provider cannot leave an embedding role referencing incompatible text credentials; the whole update is rejected.

An unconfigured deployment is represented by no row and revision `0`. The first successful create requires expected revision `0` and creates revision `1`; each subsequent update increments the revision.

## Credential Security

`APP_SECRET` must be base64url-encoded and decode to at least 32 random bytes. HKDF-SHA-256 derives a 256-bit key with the context `talqo:ai-provider-credentials:v1`. Credentials are encrypted with AES-256-GCM and a fresh 96-bit random nonce. The envelope stores its version, nonce, ciphertext, and authentication tag. The configuration ID, role, provider ID, and envelope version are authenticated as associated data so ciphertext cannot be moved between contexts.

Plaintext exists only while processing stored-credential discovery or one runtime AI operation; it is never logged. Runtime model instances are operation-scoped, may retain credentials only for that operation, and must not be cached or shared across conversation or ingestion jobs.

Field encryption protects database-only leaks such as exposed backups, snapshots, exports, read replicas, or SQL credentials. Deployment documentation explains this threat model and requires operators to back up `APP_SECRET`.

The API validates `APP_SECRET` at startup. If it changes, existing provider credentials become unusable and authorized operators must replace them.

Read responses expose authentication mode and whether a stored credential exists, but never ciphertext, nonces, secret values, or reversible masks.

## Authorization

The roles module gains `ai_provider:manage`. The sole deployment admin receives it by default and may grant it to other operators through the existing permission model. Operators without it do not see the navigation item. Routes or middleware authenticate the caller; administrative service operations enforce `ai_provider:manage`, and routes translate authorization failures to HTTP responses. Internal runtime model construction is not exposed through operator HTTP routes and does not perform operator authorization.

This permission is highly privileged because it grants access to spend-capable credentials and allows the API process to contact configured endpoints.

## API Operations And Data Flow

The module provides authenticated operations to:

- read supported-provider metadata;
- read the redacted active configuration;
- discover models using transient form credentials, deployment identity, or an existing stored credential; and
- atomically replace the active configuration using its last-read revision.

Discovery never mutates saved configuration. Static credentials supplied for discovery remain transient unless a later update explicitly saves them.

An update validates provider IDs, provider-level role support, authentication modes, required settings, credential sources, and non-empty model identifiers. It does not require a successful model-list request or validate the selected model's type.

The service decrypts credentials only for discovery using a stored credential or for constructing an operation-scoped Vercel AI SDK model. Consumers receive the appropriate SDK model interface, not provider settings or plaintext credentials, and must discard it when that operation ends.

## OpenAI-Compatible Endpoint Policy

Operators with `ai_provider:manage` may configure arbitrary public, private, local, HTTP, or HTTPS OpenAI-compatible endpoints. This intentionally permits API-server network reach needed by private vLLM and similar deployments and consequently creates SSRF-like capability for those operators.

The adapter rejects non-HTTP protocols, applies strict connection and response timeouts and response-size limits, sanitizes returned errors, and never forwards credentials across a cross-origin redirect. It does not block private, loopback, or link-local addresses. Deployment documentation must make this trust decision explicit.

## Errors And Concurrency

Discovery errors are normalized as unauthorized, unreachable, rate-limited, unsupported discovery, or provider error. Raw provider responses, authorization headers, and credentials are excluded from logs and client errors. A failure preserves form state and enables retry or manual identifier entry.

Updates use optimistic concurrency. The client submits the revision it read, including revision `0` for initial creation; if another operator has saved a newer configuration, the API rejects the stale update. The page preserves local edits and instructs the operator to reload before retrying rather than silently overwriting the newer configuration.

Invalid stored schema, failed decryption, or missing runtime identity marks the configuration unusable. Redacted reads report the `unusable` health state without underlying secret or cryptographic detail.

## Durable Test Strategy

Tests target stable security and behavior boundaries rather than markup or vendor catalog details:

- Service tests cover both required roles, provider-level role compatibility, credential reuse, redacted reads, revision conflicts, normalized discovery outcomes, and rejection of unusable or tampered encrypted credentials.
- Provider adapter contract tests use fixed mocked responses to verify normalized identifiers, unsupported discovery, secret-safe failures, and cloud identity token refresh.
- PostgreSQL integration tests verify that plaintext credentials are absent from stored data, updates are atomic, and stale revisions cannot overwrite newer configuration.
- Route tests verify authentication, `ai_provider:manage`, malformed input, and absence of secrets from redacted and unauthorized responses.
- Two end-to-end journeys cover a granted operator saving separate text and embedding providers and reloading redacted state, plus an ungranted operator being unable to see or access the page. Provider behavior comes from one controlled fake service.

Validation, manual fallback, credential reuse, and accessible feedback are exercised within those journeys.

## Required Documentation Changes

Implementation must:

- add an ADR for adopting the Vercel AI SDK and provider-adapter strategy;
- update `docs/architecture.md` and the module diagram with the implemented module boundary and the Vercel AI SDK's role;
- revise SRS FR-2.9 from requiring an endpoint and API key to requiring a valid provider authentication source plus only the endpoint settings required by that provider;
- revise SRS FR-2.17 to require explicit embedding model selection rather than an unstable provider-specific default, update its completion state, and retain the requirement that credentials are encrypted at rest;
- resolve the existing SRS database assumption against the accepted PostgreSQL ADR and canonical architecture;
- document `APP_SECRET`, its loss behavior, static credentials, deployment identity, model discovery limitations, and the OpenAI-compatible endpoint trust model; and
- update all web locale files together with identical key sets and literal translation-key calls.

## Success Criteria

- A granted operator can save and later edit one required text and one required embedding configuration.
- The two roles can use different providers or safely reuse one compatible credential source.
- Discoverable model identifiers appear in searchable dropdowns, and unsupported or failed discovery permits manual identifiers.
- OpenAI, Anthropic, Google Gemini, Mistral, Azure OpenAI, Amazon Bedrock, and OpenAI-compatible configurations produce the appropriate Vercel AI SDK model interfaces.
- Stored and returned data never contain plaintext provider credentials.
- Unauthorized operators cannot discover models, read configuration metadata, update configuration, or access the dashboard page.
- Concurrent edits cannot silently overwrite each other.
