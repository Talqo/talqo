import type { CredentialEnvelope, createCredentialVault } from "@/lib/credential-vault.ts"

import { APICallError, type EmbeddingModelV4, type LanguageModelV4 } from "@ai-sdk/provider"
import { embed as aiEmbed, isStepCount, streamText as aiStreamText } from "ai"

import type { DiscoverModelsInput, SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { StoredConfiguration, StoredEmbeddingConfiguration, StoredTextConfiguration } from "./ai-provider.types.ts"

import { validateConfigurationInput } from "./ai-provider.configuration.ts"
import { discoverModels as discoverProviderModels, type DiscoveryRequest } from "./ai-provider.discovery.ts"
import { createProviderModel } from "./ai-provider.models.ts"
import { PROVIDER_DEFINITIONS, getProviderDefinition } from "./ai-provider.registry.ts"

export type { StoredConfiguration } from "./ai-provider.types.ts"

const CONFIG_ID = "singleton"

/**
 * `streamText` defaults to `isStepCount(1)`, so a tool result would never reach the model and every
 * answer would ignore the data while appearing to work. Each step is a separately billed call, which
 * is what this bound exists to cap.
 */
const MAX_TOOL_STEPS = 5

/** How a resolved tool identifies itself to a caller. Carried opaquely; no MCP types cross over. */
export type ToolIdentity = { serverName: string; toolName: string }

export type ToolEvent =
	| { identity: ToolIdentity; toolCallId: string; type: "tool-start" }
	| { identity: ToolIdentity; outcome: "completed" | "failed"; toolCallId: string; type: "tool-end" }

type Vault = ReturnType<typeof createCredentialVault>
type Repository = {
	find(): Promise<StoredConfiguration | undefined>
	save(
		configuration: Omit<StoredConfiguration, "revision">,
		expectedRevision: number,
	): Promise<StoredConfiguration | undefined>
}

export type TextMessage = { content: string; role: "assistant" | "system" | "user" }

/** What a caller hands `invoke`: the tool record plus the names behind each key. */
export type ToolBinding = {
	names: Map<string, ToolIdentity>
	tools: Record<string, unknown>
}
type RuntimeTextMessage = { content: string; role: "assistant" | "user" }
export type PrepareTextOperationInput = {
	maxOutputTokens: number
	messages: TextMessage[]
	timeoutMs: number
}
type RawGenerationEvent =
	| { text: string; type: "text" }
	| {
			outcome: "cancelled" | "completed" | "failed" | "interrupted"
			type: "finish"
			usage: {
				inputTokens?: number
				inputTokenDetails?: { cacheReadTokens?: number; cacheWriteTokens?: number; noCacheTokens?: number }
				outputTokens?: number
				outputTokenDetails?: { reasoningTokens?: number; textTokens?: number }
				totalTokens?: number
			}
	  }
type Generate = (input: {
	instructions?: string
	maxOutputTokens: number
	maxRetries: 0
	messages: RuntimeTextMessage[]
	model: LanguageModelV4
	onToolEvent?: (event: ToolEvent) => void
	signal: AbortSignal
	timeoutMs: number
	toolNames?: Map<string, ToolIdentity>
	tools?: Record<string, unknown>
}) => AsyncIterable<RawGenerationEvent>

type ServiceDependencies = {
	discover(input: DiscoveryRequest): Promise<string[]>
	generate?: Generate
	repository: Repository
	vault: Vault
}

type RedactedRole = Omit<StoredTextConfiguration, "credentials"> & { hasCredentials: boolean }
type RedactedConfiguration = {
	revision: number
	health: "unconfigured" | "configured" | "unusable"
	text: RedactedRole | null
	embedding: (RedactedRole & { credentialSource: StoredEmbeddingConfiguration["credentialSource"] }) | null
}

export class RevisionConflictError extends Error {}
export class InvalidConfigurationError extends Error {}
export class UnusableConfigurationError extends Error {}
export class ProviderContextLimitError extends Error {}
const BAD_REQUEST_STATUS = 400
const PAYLOAD_TOO_LARGE_STATUS = 413

function isContextLimitError(error: unknown): boolean {
	if (
		!APICallError.isInstance(error) ||
		(error.statusCode !== BAD_REQUEST_STATUS && error.statusCode !== PAYLOAD_TOO_LARGE_STATUS)
	) {
		return false
	}
	const details = [error.message, error.responseBody, JSON.stringify(error.data ?? null)].join(" ")
	// Providers disagree on status and body codes for context overflow; text is the only signal.
	return /context[_ -]?(?:length|window|limit)|maximum context|input.+too (?:large|long)|prompt is too long|exceeds the maximum.+token|too many tokens/i.test(
		details,
	)
}

async function* invokePreparedOperation(
	generate: Generate,
	input: PrepareTextOperationInput & {
		instructions?: string
		messages: RuntimeTextMessage[]
		model: LanguageModelV4
		modelId: string
		onToolEvent?: (event: ToolEvent) => void
		providerId: string
		signal: AbortSignal
		toolNames?: Map<string, ToolIdentity>
		tools?: Record<string, unknown>
	},
) {
	try {
		for await (const event of generate({
			instructions: input.instructions,
			messages: input.messages,
			model: input.model,
			maxOutputTokens: input.maxOutputTokens,
			maxRetries: 0,
			signal: input.signal,
			timeoutMs: input.timeoutMs,
			...(input.tools ? { tools: input.tools, toolNames: input.toolNames, onToolEvent: input.onToolEvent } : {}),
		})) {
			if (event.type === "text") yield event
			else yield { ...event, provider: input.providerId, model: input.modelId }
		}
	} catch (error) {
		if (isContextLimitError(error)) throw new ProviderContextLimitError("Provider context limit exceeded")
		throw error
	}
}

const defaultGenerate: Generate = async function* (input) {
	let result: ReturnType<typeof aiStreamText> | undefined
	try {
		result = aiStreamText({
			model: input.model,
			instructions: input.instructions,
			messages: input.messages,
			maxOutputTokens: input.maxOutputTokens,
			maxRetries: input.maxRetries,
			abortSignal: input.signal,
			timeout: input.timeoutMs,
			stopWhen: isStepCount(MAX_TOOL_STEPS),
			onError: () => undefined,
			...(input.tools ? { tools: input.tools as never } : {}),
			...toolCallbacks(input),
		})
		for await (const text of result.textStream) yield { type: "text", text }
		const usage = await result.usage
		yield {
			type: "finish",
			outcome: "completed",
			usage: {
				inputTokens: usage.inputTokens,
				inputTokenDetails: usage.inputTokenDetails,
				outputTokens: usage.outputTokens,
				outputTokenDetails: usage.outputTokenDetails,
				totalTokens: usage.totalTokens,
			},
		}
	} catch (error) {
		if (result) void Promise.resolve(result.usage).catch(() => undefined)
		if (input.signal.aborted) {
			yield { type: "finish", outcome: "cancelled", usage: {} }
			return
		}
		throw error
	}
}

/**
 * Emitted through a callback rather than the event stream so tool activity reaches the client the
 * moment it happens, instead of waiting for the next text chunk to flush.
 */
type ToolCallbackOptions = Pick<Parameters<typeof aiStreamText>[0], "onToolExecutionStart" | "onToolExecutionEnd">

function toolCallbacks(input: Parameters<Generate>[0]): ToolCallbackOptions {
	if (!input.tools || !input.onToolEvent) return {}
	const identity = (name: string): ToolIdentity => input.toolNames?.get(name) ?? { serverName: "", toolName: name }
	const emit = input.onToolEvent
	return {
		onToolExecutionStart: ({ toolCall }) =>
			emit({ type: "tool-start", identity: identity(toolCall.toolName), toolCallId: toolCall.toolCallId }),
		onToolExecutionEnd: ({ toolCall, toolOutput }) =>
			emit({
				type: "tool-end",
				identity: identity(toolCall.toolName),
				toolCallId: toolCall.toolCallId,
				// A tool-result carrying isError still reports success upstream; the demo server proves it.
				outcome: toolOutput.type === "tool-result" && !isErrorOutput(toolOutput.output) ? "completed" : "failed",
			}),
	}
}

/** MCP servers answer failures inside a successful result envelope. */
function isErrorOutput(output: unknown): boolean {
	return !!output && typeof output === "object" && (output as { isError?: unknown }).isError === true
}
function settingsEqual(first: Record<string, string>, second: Record<string, string>): boolean {
	const firstKeys = Object.keys(first)
	const secondKeys = Object.keys(second)
	return firstKeys.length === secondKeys.length && firstKeys.every((key) => first[key] === second[key])
}

function sameContext(
	stored: StoredTextConfiguration,
	input: { authMode: StoredTextConfiguration["authMode"]; providerId: string; settings: Record<string, string> },
): boolean {
	return (
		stored.providerId === input.providerId &&
		stored.authMode === input.authMode &&
		settingsEqual(stored.settings, input.settings)
	)
}

function requiredCredentialsPresent(providerId: string, credentials: Record<string, string>): boolean {
	return getProviderDefinition(providerId).requiredCredentialFields.every((field) => credentials[field]?.trim())
}

function resolveEnvelope(
	input: {
		existing?: StoredTextConfiguration
		providerId: string
		role: "text" | "embedding"
		settings: Record<string, string>
	} & ({ authMode: "static"; credentials?: Record<string, string> } | { authMode: "deployment-identity" }),
	vault: Vault,
): CredentialEnvelope | null {
	if (input.authMode === "deployment-identity") {
		if ("credentials" in input && input.credentials) {
			throw new InvalidConfigurationError(
				`${input.providerId} does not accept static credentials with deployment-identity authentication`,
			)
		}
		return null
	}
	if (input.credentials) {
		if (!requiredCredentialsPresent(input.providerId, input.credentials)) {
			throw new InvalidConfigurationError(`${input.providerId} credentials are incomplete`)
		}
		return vault.encrypt(input.credentials, { configId: CONFIG_ID, providerId: input.providerId, role: input.role })
	}
	if (input.existing && sameContext(input.existing, input)) {
		if (!input.existing.credentials) throw new InvalidConfigurationError(`${input.providerId} credentials are required`)
		return input.existing.credentials
	}
	throw new InvalidConfigurationError(`${input.providerId} credentials are required for the selected credential source`)
}

function redact(configuration: StoredConfiguration | undefined, vault: Vault): RedactedConfiguration {
	if (!configuration) return { revision: 0, health: "unconfigured", text: null, embedding: null }
	let health: RedactedConfiguration["health"] = "configured"
	try {
		if (configuration.text.credentials) {
			vault.decrypt(configuration.text.credentials, {
				configId: CONFIG_ID,
				providerId: configuration.text.providerId,
				role: "text",
			})
		}
		if (configuration.embedding.credentials) {
			vault.decrypt(configuration.embedding.credentials, {
				configId: CONFIG_ID,
				providerId: configuration.embedding.providerId,
				role: "embedding",
			})
		}
	} catch {
		health = "unusable"
	}
	const { credentials: textCredentials, ...text } = configuration.text
	const { credentials: embeddingCredentials, ...embedding } = configuration.embedding
	return {
		revision: configuration.revision,
		health,
		text: { ...text, hasCredentials: textCredentials !== null },
		embedding: { ...embedding, hasCredentials: embeddingCredentials !== null },
	}
}

export function createAiProviderService(dependencies: ServiceDependencies) {
	return {
		repository: dependencies.repository,
		getProviders() {
			return PROVIDER_DEFINITIONS.map((provider) => ({
				id: provider.id,
				roles: [...provider.roles],
				authModes: [...provider.authModes],
				settingFields: [...provider.settingFields],
				requiredSettingFields: [...provider.requiredSettingFields],
				credentialFields: [...provider.credentialFields],
				requiredCredentialFields: [...provider.requiredCredentialFields],
				discovery: provider.discovery,
			}))
		},
		async getConfiguration(): Promise<RedactedConfiguration> {
			return redact(await dependencies.repository.find(), dependencies.vault)
		},
		async saveConfiguration(input: SaveConfigurationInput): Promise<RedactedConfiguration> {
			const existing = await dependencies.repository.find()
			try {
				validateConfigurationInput(input, {
					text: existing?.text ? { credentials: existing.text.credentials !== null } : undefined,
					embedding: existing?.embedding ? { credentials: existing.embedding.credentials !== null } : undefined,
				})
			} catch (error) {
				throw new InvalidConfigurationError(error instanceof Error ? error.message : "Invalid configuration")
			}
			const existingInput = {
				text: { ...input.text, existing: existing?.text },
				embedding: { ...input.embedding, existing: existing?.embedding },
			}
			const textCredentials = resolveEnvelope({ ...existingInput.text, role: "text" }, dependencies.vault)
			let embeddingCredentials: CredentialEnvelope | null = null
			if (input.embedding.credentialSource === "separate") {
				embeddingCredentials = resolveEnvelope({ ...existingInput.embedding, role: "embedding" }, dependencies.vault)
			}
			const embedding: StoredEmbeddingConfiguration = {
				providerId: input.embedding.providerId,
				modelId: input.embedding.modelId,
				authMode: input.embedding.authMode,
				settings: input.embedding.settings,
				credentialSource: input.embedding.credentialSource,
				credentials: embeddingCredentials,
			}
			const saved = await dependencies.repository.save(
				{
					id: CONFIG_ID,
					text: {
						providerId: input.text.providerId,
						modelId: input.text.modelId,
						authMode: input.text.authMode,
						settings: input.text.settings,
						credentials: textCredentials,
					},
					embedding,
				},
				input.expectedRevision,
			)
			if (!saved) throw new RevisionConflictError("AI provider configuration changed; reload and retry")
			return redact(saved, dependencies.vault)
		},
		async discoverModels(input: DiscoverModelsInput): Promise<string[]> {
			let credentials = input.authMode === "static" ? input.credentials : undefined
			if (!credentials && input.authMode === "static" && input.storedCredentialRole) {
				const stored = await dependencies.repository.find()
				if (!stored) throw new InvalidConfigurationError("No stored credentials are available")
				let role = input.storedCredentialRole
				let storedRole: StoredTextConfiguration = stored[role]
				if (role === "embedding" && stored.embedding.credentialSource === "text") {
					role = "text"
					storedRole = stored.text
				}
				if (!sameContext(storedRole, input)) {
					throw new InvalidConfigurationError("Stored credentials do not match this provider context")
				}
				if (storedRole.credentials) {
					credentials = dependencies.vault.decrypt(storedRole.credentials, {
						configId: CONFIG_ID,
						providerId: storedRole.providerId,
						role,
					})
				}
			}
			return dependencies.discover({
				authMode: input.authMode,
				providerId: input.providerId,
				settings: input.settings,
				credentials,
			})
		},
		async prepareEmbeddingOperation() {
			const stored = await dependencies.repository.find()
			if (!stored) throw new UnusableConfigurationError("AI provider configuration is missing")
			try {
				const useTextCredentials = stored.embedding.credentialSource === "text"
				const envelope = useTextCredentials ? stored.text.credentials : stored.embedding.credentials
				const credentials = envelope
					? dependencies.vault.decrypt(envelope, {
							configId: CONFIG_ID,
							providerId: stored.embedding.providerId,
							role: useTextCredentials ? "text" : "embedding",
						})
					: undefined
				const model = createProviderModel({
					...stored.embedding,
					role: "embedding",
					credentials,
				}) as EmbeddingModelV4
				return {
					key: JSON.stringify([
						stored.embedding.providerId,
						stored.embedding.modelId,
						Object.entries(stored.embedding.settings).toSorted(([a], [b]) => a.localeCompare(b)),
					]),
					async embed(text: string) {
						return (await aiEmbed({ model, value: text, maxRetries: 0 })).embedding
					},
				}
			} catch {
				throw new UnusableConfigurationError("AI provider configuration is unusable")
			}
		},
		async prepareTextOperation(input: PrepareTextOperationInput) {
			const stored = await dependencies.repository.find()
			if (!stored) throw new UnusableConfigurationError("AI provider configuration is missing")
			try {
				const credentials = stored.text.credentials
					? dependencies.vault.decrypt(stored.text.credentials, {
							configId: CONFIG_ID,
							providerId: stored.text.providerId,
							role: "text",
						})
					: undefined
				const model = createProviderModel({ ...stored.text, role: "text", credentials }) as LanguageModelV4
				const [firstMessage, ...remainingMessages] = input.messages
				const instructions = firstMessage?.role === "system" ? firstMessage.content : undefined
				const messages = (instructions === undefined ? input.messages : remainingMessages) as RuntimeTextMessage[]
				const generate = dependencies.generate ?? defaultGenerate
				return {
					provider: stored.text.providerId,
					model: stored.text.modelId,
					invoke(signal: AbortSignal, tools?: ToolBinding, onToolEvent?: (event: ToolEvent) => void) {
						return invokePreparedOperation(generate, {
							...input,
							...(instructions === undefined ? {} : { instructions }),
							messages,
							model,
							providerId: stored.text.providerId,
							modelId: stored.text.modelId,
							signal,
							...(tools ? { tools: tools.tools, toolNames: tools.names } : {}),
							onToolEvent,
						})
					},
				}
			} catch (error) {
				if (error instanceof UnusableConfigurationError) throw error
				throw new UnusableConfigurationError("AI provider configuration is unusable")
			}
		},
	}
}

let defaultServicePromise: Promise<ReturnType<typeof createAiProviderService>> | undefined

async function getDefaultService(): Promise<ReturnType<typeof createAiProviderService>> {
	defaultServicePromise ??= Promise.all([
		import("@/config/env.ts"),
		import("./ai-provider.repository.ts"),
		import("@/lib/credential-vault.ts"),
	]).then(([{ env }, repository, { createCredentialVault }]) =>
		createAiProviderService({
			discover: (input) => discoverProviderModels(input),
			repository,
			vault: createCredentialVault(env.APP_SECRET, "talqo:ai-provider-credentials:v1"),
		}),
	)
	return defaultServicePromise
}

export async function getProviders() {
	return (await getDefaultService()).getProviders()
}

export async function getConfiguration() {
	return (await getDefaultService()).getConfiguration()
}

export async function saveConfiguration(input: SaveConfigurationInput) {
	return (await getDefaultService()).saveConfiguration(input)
}

export async function discoverModels(input: DiscoverModelsInput) {
	return (await getDefaultService()).discoverModels(input)
}

export async function prepareTextOperation(input: PrepareTextOperationInput) {
	return (await getDefaultService()).prepareTextOperation(input)
}

export async function prepareEmbeddingOperation(): Promise<{ key: string; embed(text: string): Promise<number[]> }> {
	return (await getDefaultService()).prepareEmbeddingOperation()
}
