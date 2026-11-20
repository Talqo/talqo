import type { Annotate } from "@/http/wide-event.ts"
import type { createCredentialVault, CredentialEnvelope } from "@/lib/credential-vault.ts"

import { ApiError, PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"
import { APICallError, type EmbeddingModelV4, type LanguageModelV4 } from "@ai-sdk/provider"
import { embed as aiEmbed, isStepCount, type ModelMessage, streamText as aiStreamText, type ToolSet } from "ai"

import type { DiscoverModelsInput, SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { StoredConfiguration, StoredEmbeddingConfiguration, StoredTextConfiguration } from "./ai-provider.types.ts"

import { validateConfigurationInput } from "./ai-provider.configuration.ts"
import { discoverModels as discoverProviderModels, type DiscoveryRequest } from "./ai-provider.discovery.ts"
import { createProviderModel } from "./ai-provider.models.ts"
import { type AiProviderId, getProviderDefinition, PROVIDER_DEFINITIONS } from "./ai-provider.registry.ts"

export type { AiProviderId } from "./ai-provider.registry.ts"
export type { StoredConfiguration } from "./ai-provider.types.ts"

const CONFIG_ID = "singleton"

/**
 * `streamText` defaults to one step, which drops tool results. Each step is billed, so the bound caps cost.
 */
const MAX_TOOL_STEPS = 5

/** How a resolved tool identifies itself to a caller. Carried opaquely; no MCP types cross over. */
export type ToolIdentity = { serverName: string; toolName: string; source?: "client" | "mcp" }

export type ToolEvent =
	| { identity: ToolIdentity; toolCallId: string; toolName: string; input: unknown; type: "tool-start" }
	| {
			identity: ToolIdentity
			outcome: "completed" | "failed"
			toolCallId: string
			output?: unknown
			errorText?: string
			type: "tool-end"
	  }

type Vault = ReturnType<typeof createCredentialVault>
type Repository = {
	find(): Promise<StoredConfiguration | undefined>
	save(
		configuration: Omit<StoredConfiguration, "revision">,
		expectedRevision: number,
	): Promise<StoredConfiguration | undefined>
}

/** What a caller hands `invoke`: the tool record plus the names behind each key. */
export type ToolBinding = {
	names: Map<string, ToolIdentity>
	tools: ToolSet
}
export type PrepareTextOperationInput = {
	maxOutputTokens: number
	messages: ModelMessage[]
	timeoutMs: number
}
type RawGenerationEvent =
	| { text: string; type: "text" }
	| { type: "step-start" }
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
	messages: ModelMessage[]
	model: LanguageModelV4
	onToolEvent?: (event: ToolEvent) => void | Promise<void>
	signal: AbortSignal
	timeoutMs: number
	toolNames?: Map<string, ToolIdentity>
	tools?: ToolSet
}) => AsyncIterable<RawGenerationEvent>

type ServiceDependencies = {
	discover(input: DiscoveryRequest): Promise<string[]>
	generate?: Generate
	repository: Repository
	/** streamText is injectable so tests can observe the call options, particularly the step bound. */
	streamText?: typeof aiStreamText
	vault: Vault
}

type RedactedRole = Omit<StoredTextConfiguration, "credentials"> & { hasCredentials: boolean }
type RedactedConfiguration = {
	revision: number
	health: "unconfigured" | "configured" | "unusable"
	text: RedactedRole | null
	embedding: (RedactedRole & { credentialSource: StoredEmbeddingConfiguration["credentialSource"] }) | null
}

class RevisionConflictError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.CONFIGURATION_CONFLICT, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}
export class InvalidConfigurationError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.INVALID_AI_PROVIDER_CONFIGURATION, HTTP_STATUS.BAD_REQUEST, message, undefined, options)
	}
}
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
		messages: ModelMessage[]
		model: LanguageModelV4
		modelId: string
		onToolEvent?: (event: ToolEvent) => void | Promise<void>
		providerId: AiProviderId
		signal: AbortSignal
		toolNames?: Map<string, ToolIdentity>
		tools?: ToolSet
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
			if (event.type === "text" || event.type === "step-start") yield event
			else yield { ...event, provider: input.providerId, model: input.modelId }
		}
	} catch (error) {
		if (isContextLimitError(error)) throw new ProviderContextLimitError("Provider context limit exceeded")
		throw error
	}
}

async function* defaultGenerate(input: Parameters<Generate>[0], streamText: typeof aiStreamText): ReturnType<Generate> {
	let result: ReturnType<typeof aiStreamText> | undefined
	const persistedCalls = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>()
	const completedCalls = new Set<string>()
	function callPersistence(id: string) {
		let pending = persistedCalls.get(id)
		if (!pending) {
			pending = Promise.withResolvers<void>()
			void pending.promise.catch(() => undefined)
			persistedCalls.set(id, pending)
		}
		return pending
	}
	const abort = () => {
		for (const pending of persistedCalls.values()) pending.reject(new Error("Tool execution aborted"))
	}
	const identity = (name: string): ToolIdentity => input.toolNames?.get(name) ?? { serverName: "", toolName: name }
	async function recordToolCall(part: { input: unknown; toolCallId: string; toolName: string }): Promise<void> {
		await input.onToolEvent?.({
			type: "tool-start",
			identity: identity(part.toolName),
			toolCallId: part.toolCallId,
			toolName: part.toolName,
			input: part.input,
		})
		callPersistence(part.toolCallId).resolve()
	}
	async function recordToolError(part: { toolCallId: string; toolName: string }): Promise<void> {
		if (completedCalls.has(part.toolCallId)) return
		// Claim before awaiting so the execution callback cannot emit a second end for this call.
		completedCalls.add(part.toolCallId)
		await input.onToolEvent?.({
			type: "tool-end",
			identity: identity(part.toolName),
			toolCallId: part.toolCallId,
			outcome: "failed",
			errorText: "Tool execution failed",
		})
	}
	async function* streamParts(stream: ReturnType<typeof aiStreamText>) {
		for await (const part of stream.fullStream) {
			if (part.type === "text-delta") yield { type: "text" as const, text: part.text }
			else if (part.type === "start-step") yield { type: "step-start" as const }
			else if (part.type === "tool-call") await recordToolCall(part)
			else if (part.type === "tool-error") await recordToolError(part)
			else if (part.type === "error") throw part.error
		}
	}
	input.signal.addEventListener("abort", abort, { once: true })
	try {
		result = streamText({
			model: input.model,
			instructions: input.instructions,
			messages: input.messages,
			maxOutputTokens: input.maxOutputTokens,
			maxRetries: input.maxRetries,
			abortSignal: input.signal,
			timeout: input.timeoutMs,
			stopWhen: isStepCount(MAX_TOOL_STEPS),
			onError: () => undefined,
			...(input.tools ? { tools: input.tools } : {}),
			onAbort: abort,
			onToolExecutionStart: async ({ toolCall }) => {
				// Execution can run ahead of fullStream; wait for the ordered call to become durable.
				input.signal.throwIfAborted()
				await callPersistence(toolCall.toolCallId).promise
			},
			onToolExecutionEnd: async ({ toolCall, toolOutput }) => {
				if (completedCalls.has(toolCall.toolCallId)) return
				// Claim before awaiting so the stream callback cannot emit a second end for this call.
				completedCalls.add(toolCall.toolCallId)
				await input.onToolEvent?.({
					type: "tool-end",
					identity: identity(toolCall.toolName),
					toolCallId: toolCall.toolCallId,
					outcome: toolOutput.type === "tool-result" && !isErrorOutput(toolOutput.output) ? "completed" : "failed",
					...(toolOutput.type === "tool-result"
						? { output: toolOutput.output }
						: { errorText: "Tool execution failed" }),
				})
			},
		})
		yield* streamParts(result)
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
	} finally {
		input.signal.removeEventListener("abort", abort)
		abort()
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

// Knowledge base chunks are indexed under this key; a new key makes the worker re-embed every file.
function embeddingKey(embedding: Pick<StoredEmbeddingConfiguration, "modelId" | "providerId" | "settings">): string {
	return JSON.stringify([
		embedding.providerId,
		embedding.modelId,
		Object.entries(embedding.settings).toSorted(([a], [b]) => a.localeCompare(b)),
	])
}

function requiredCredentialsPresent(providerId: string, credentials: Record<string, string>): boolean {
	return getProviderDefinition(providerId).requiredCredentialFields.every((field) => credentials[field]?.trim())
}

function rejectStaticCredentials(
	input:
		| ({ providerId: string } & { authMode: "static"; credentials?: Record<string, string> })
		| { authMode: "deployment-identity" },
): void {
	if ("credentials" in input && input.credentials) {
		throw new InvalidConfigurationError(
			`${input.providerId} does not accept static credentials with deployment-identity authentication`,
		)
	}
}

function encryptCredentials(
	input: {
		providerId: string
		role: "text" | "embedding"
	} & { authMode: "static"; credentials?: Record<string, string> },
	vault: Vault,
): CredentialEnvelope {
	if (!input.credentials || !requiredCredentialsPresent(input.providerId, input.credentials)) {
		throw new InvalidConfigurationError(`${input.providerId} credentials are incomplete`)
	}
	return vault.encrypt(input.credentials, { configId: CONFIG_ID, providerId: input.providerId, role: input.role })
}

function reuseStoredCredentials(
	input: {
		existing?: StoredTextConfiguration
		providerId: string
		settings: Record<string, string>
	} & { authMode: "static"; credentials?: Record<string, string> },
): CredentialEnvelope | undefined {
	if (!input.existing || !sameContext(input.existing, input)) return undefined
	if (!input.existing.credentials) throw new InvalidConfigurationError(`${input.providerId} credentials are required`)
	return input.existing.credentials
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
		rejectStaticCredentials(input)
		return null
	}
	if (input.credentials) return encryptCredentials(input, vault)
	const reused = reuseStoredCredentials(input)
	if (reused) return reused
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

function existingCredentialState(stored: StoredTextConfiguration | undefined): { credentials: boolean } | undefined {
	return stored ? { credentials: stored.credentials !== null } : undefined
}

function validateSaveInput(input: SaveConfigurationInput, existing: StoredConfiguration | undefined): void {
	try {
		validateConfigurationInput(input, {
			text: existingCredentialState(existing?.text),
			embedding: existingCredentialState(existing?.embedding),
		})
	} catch (error) {
		throw new InvalidConfigurationError(error instanceof Error ? error.message : "Invalid configuration")
	}
}

function resolveConfigurationEnvelopes(
	input: SaveConfigurationInput,
	existing: StoredConfiguration | undefined,
	vault: Vault,
): { embedding: CredentialEnvelope | null; text: CredentialEnvelope | null } {
	const text = resolveEnvelope({ ...input.text, existing: existing?.text, role: "text" }, vault)
	const embedding =
		input.embedding.credentialSource === "separate"
			? resolveEnvelope({ ...input.embedding, existing: existing?.embedding, role: "embedding" }, vault)
			: null
	return { text, embedding }
}

function toStoredEmbedding(
	input: SaveConfigurationInput["embedding"],
	credentials: CredentialEnvelope | null,
): StoredEmbeddingConfiguration {
	return {
		providerId: input.providerId,
		modelId: input.modelId,
		authMode: input.authMode,
		settings: input.settings,
		credentialSource: input.credentialSource,
		credentials,
	}
}

function decryptTextCredentials(stored: StoredTextConfiguration, vault: Vault): Record<string, string> | undefined {
	if (!stored.credentials) return undefined
	return vault.decrypt(stored.credentials, {
		configId: CONFIG_ID,
		providerId: stored.providerId,
		role: "text",
	})
}

function splitInstructions(messages: ModelMessage[]): {
	instructions?: string
	messages: ModelMessage[]
} {
	const [firstMessage, ...remainingMessages] = messages
	if (firstMessage?.role === "system") return { instructions: firstMessage.content, messages: remainingMessages }
	return { messages }
}

function createGenerate(dependencies: ServiceDependencies, streamText: typeof aiStreamText): Generate {
	return dependencies.generate ?? ((generation) => defaultGenerate(generation, streamText))
}

async function resolveStoredDiscoveryCredentials(
	input: DiscoverModelsInput & { authMode: "static"; storedCredentialRole: "text" | "embedding" },
	repository: Repository,
	vault: Vault,
): Promise<Record<string, string> | undefined> {
	const stored = await repository.find()
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
	if (!storedRole.credentials) return undefined
	return vault.decrypt(storedRole.credentials, {
		configId: CONFIG_ID,
		providerId: storedRole.providerId,
		role,
	})
}

export function createAiProviderService(dependencies: ServiceDependencies) {
	return {
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
		// Replies need only the text role; a broken embedding role degrades retrieval instead.
		async canGenerateText(): Promise<boolean> {
			const stored = await dependencies.repository.find()
			if (!stored) return false
			if (!stored.text.credentials) return true
			try {
				dependencies.vault.decrypt(stored.text.credentials, {
					configId: CONFIG_ID,
					providerId: stored.text.providerId,
					role: "text",
				})
				return true
			} catch {
				return false
			}
		},
		async saveConfiguration(
			input: SaveConfigurationInput,
			annotate: Annotate = () => {},
		): Promise<RedactedConfiguration> {
			const existing = await dependencies.repository.find()
			validateSaveInput(input, existing)
			const envelopes = resolveConfigurationEnvelopes(input, existing, dependencies.vault)
			const embedding = toStoredEmbedding(input.embedding, envelopes.embedding)
			const saved = await dependencies.repository.save(
				{
					id: CONFIG_ID,
					text: {
						providerId: input.text.providerId,
						modelId: input.text.modelId,
						authMode: input.text.authMode,
						settings: input.text.settings,
						credentials: envelopes.text,
					},
					embedding,
				},
				input.expectedRevision,
			)
			if (!saved) throw new RevisionConflictError("AI provider configuration changed; reload and retry")
			annotate({
				"ai.embedding.changed": !existing || embeddingKey(existing.embedding) !== embeddingKey(embedding),
			})
			return redact(saved, dependencies.vault)
		},
		async discoverModels(input: DiscoverModelsInput): Promise<string[]> {
			let credentials = input.authMode === "static" ? input.credentials : undefined
			if (!credentials && input.authMode === "static" && input.storedCredentialRole) {
				credentials = await resolveStoredDiscoveryCredentials(
					{ ...input, storedCredentialRole: input.storedCredentialRole },
					dependencies.repository,
					dependencies.vault,
				)
			}
			return dependencies.discover({
				authMode: input.authMode,
				providerId: input.providerId,
				settings: input.settings,
				credentials,
			})
		},
		async prepareEmbeddingOperation(options?: { timeoutMs?: number }) {
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
					key: embeddingKey(stored.embedding),
					async embed(text: string, signal?: AbortSignal) {
						return (
							await aiEmbed({
								model,
								value: text,
								maxRetries: 0,
								abortSignal: signal ?? (options?.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined),
							})
						).embedding
					},
				}
			} catch (error) {
				if (error instanceof UnusableConfigurationError) throw error
				throw new UnusableConfigurationError("AI provider configuration is unusable", { cause: error })
			}
		},
		async prepareTextOperation(input: PrepareTextOperationInput) {
			const stored = await dependencies.repository.find()
			if (!stored) throw new UnusableConfigurationError("AI provider configuration is missing")
			try {
				const credentials = decryptTextCredentials(stored.text, dependencies.vault)
				const model = createProviderModel({ ...stored.text, role: "text", credentials }) as LanguageModelV4
				const { instructions, messages } = splitInstructions(input.messages)
				const streamText = dependencies.streamText ?? aiStreamText
				const generate = createGenerate(dependencies, streamText)
				return {
					provider: stored.text.providerId,
					model: stored.text.modelId,
					invoke(signal: AbortSignal, tools?: ToolBinding, onToolEvent?: (event: ToolEvent) => void | Promise<void>) {
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
				throw new UnusableConfigurationError("AI provider configuration is unusable", { cause: error })
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

export async function canGenerateText(): Promise<boolean> {
	return (await getDefaultService()).canGenerateText()
}

export async function saveConfiguration(input: SaveConfigurationInput, annotate?: Annotate) {
	return (await getDefaultService()).saveConfiguration(input, annotate)
}

export async function discoverModels(input: DiscoverModelsInput) {
	return (await getDefaultService()).discoverModels(input)
}

export async function prepareTextOperation(input: PrepareTextOperationInput) {
	return (await getDefaultService()).prepareTextOperation(input)
}

export async function prepareEmbeddingOperation(options?: {
	timeoutMs?: number
}): Promise<{ key: string; embed(text: string, signal?: AbortSignal): Promise<number[]> }> {
	return (await getDefaultService()).prepareEmbeddingOperation(options)
}
