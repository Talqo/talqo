import { APICallError, type LanguageModelV4 } from "@ai-sdk/provider"
import { streamText as aiStreamText } from "ai"

import type { DiscoverModelsInput, SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { StoredConfiguration, StoredEmbeddingConfiguration, StoredTextConfiguration } from "./ai-provider.types.ts"
import type { CredentialEnvelope, createCredentialVault } from "./credential-vault.ts"

import { validateConfigurationInput } from "./ai-provider.configuration.ts"
import { discoverModels as discoverProviderModels, type DiscoveryRequest } from "./ai-provider.discovery.ts"
import { createProviderModel } from "./ai-provider.models.ts"
import { PROVIDER_DEFINITIONS, getProviderDefinition } from "./ai-provider.registry.ts"

export type { StoredConfiguration } from "./ai-provider.types.ts"

const CONFIG_ID = "singleton"

type Vault = ReturnType<typeof createCredentialVault>
type Repository = {
	find(): Promise<StoredConfiguration | undefined>
	save(
		configuration: Omit<StoredConfiguration, "revision">,
		expectedRevision: number,
	): Promise<StoredConfiguration | undefined>
}

export type TextMessage = { content: string; role: "assistant" | "system" | "user" }
type RuntimeTextMessage = { content: string; role: "assistant" | "user" }
export type TextGenerationInput = {
	maxOutputTokens: number
	messages: TextMessage[]
	signal: AbortSignal
	timeoutMs: number
}
export type PrepareTextOperationInput = Omit<TextGenerationInput, "signal">
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
	signal: AbortSignal
	timeoutMs: number
}) => AsyncIterable<RawGenerationEvent>

type ServiceDependencies = {
	authorize(userId: string): Promise<boolean>
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

export class PermissionDeniedError extends Error {}
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
	return /context[_ -]?(?:length|window|limit)|maximum context|input.+too (?:large|long)|too many tokens/i.test(details)
}

async function* invokePreparedOperation(
	generate: Generate,
	input: PrepareTextOperationInput & {
		instructions?: string
		messages: RuntimeTextMessage[]
		model: LanguageModelV4
		modelId: string
		providerId: string
		signal: AbortSignal
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
	const result = aiStreamText({
		model: input.model,
		instructions: input.instructions,
		messages: input.messages,
		maxOutputTokens: input.maxOutputTokens,
		maxRetries: input.maxRetries,
		abortSignal: input.signal,
		timeout: input.timeoutMs,
	})
	try {
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
		if (input.signal.aborted) {
			yield { type: "finish", outcome: "cancelled", usage: {} }
			return
		}
		throw error
	}
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
	async function requirePermission(userId: string): Promise<void> {
		if (!(await dependencies.authorize(userId)))
			throw new PermissionDeniedError("Missing ai_provider:manage permission")
	}

	return {
		repository: dependencies.repository,
		async getProviders(userId: string) {
			await requirePermission(userId)
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
		async getConfiguration(userId: string): Promise<RedactedConfiguration> {
			await requirePermission(userId)
			return redact(await dependencies.repository.find(), dependencies.vault)
		},
		async saveConfiguration(userId: string, input: SaveConfigurationInput): Promise<RedactedConfiguration> {
			await requirePermission(userId)
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
		async discoverModels(userId: string, input: DiscoverModelsInput): Promise<string[]> {
			await requirePermission(userId)
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
		async createRuntimeModels() {
			const stored = await dependencies.repository.find()
			if (!stored) throw new UnusableConfigurationError("AI provider configuration is missing")
			try {
				const textCredentials = stored.text.credentials
					? dependencies.vault.decrypt(stored.text.credentials, {
							configId: CONFIG_ID,
							providerId: stored.text.providerId,
							role: "text",
						})
					: undefined
				const embeddingCredentials =
					stored.embedding.credentialSource === "text"
						? textCredentials
						: stored.embedding.credentials
							? dependencies.vault.decrypt(stored.embedding.credentials, {
									configId: CONFIG_ID,
									providerId: stored.embedding.providerId,
									role: "embedding",
								})
							: undefined
				return {
					text: createProviderModel({ ...stored.text, role: "text", credentials: textCredentials }),
					embedding: createProviderModel({
						...stored.embedding,
						role: "embedding",
						credentials: embeddingCredentials,
					}),
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
					invoke(signal: AbortSignal) {
						return invokePreparedOperation(generate, {
							...input,
							...(instructions === undefined ? {} : { instructions }),
							messages,
							model,
							providerId: stored.text.providerId,
							modelId: stored.text.modelId,
							signal,
						})
					},
				}
			} catch (error) {
				if (error instanceof UnusableConfigurationError) throw error
				throw new UnusableConfigurationError("AI provider configuration is unusable")
			}
		},
		async *streamText(input: TextGenerationInput) {
			const { signal, ...operationInput } = input
			const prepared = await this.prepareTextOperation(operationInput)
			yield { type: "start" as const, provider: prepared.provider, model: prepared.model }
			for await (const event of prepared.invoke(signal)) yield event
		},
	}
}

let defaultServicePromise: Promise<ReturnType<typeof createAiProviderService>> | undefined

async function getDefaultService(): Promise<ReturnType<typeof createAiProviderService>> {
	defaultServicePromise ??= Promise.all([
		import("@/config/env.ts"),
		import("@/modules/roles/roles.service.ts"),
		import("./ai-provider.repository.ts"),
		import("./credential-vault.ts"),
	]).then(([{ env }, roles, repository, { createCredentialVault }]) =>
		createAiProviderService({
			authorize: (userId) => roles.authorize(userId, roles.Permission.AiProviderManage),
			discover: (input) => discoverProviderModels(input),
			repository,
			vault: createCredentialVault(env.APP_SECRET),
		}),
	)
	return defaultServicePromise
}

export async function getProviders(userId: string) {
	return (await getDefaultService()).getProviders(userId)
}

export async function getConfiguration(userId: string) {
	return (await getDefaultService()).getConfiguration(userId)
}

export async function saveConfiguration(userId: string, input: SaveConfigurationInput) {
	return (await getDefaultService()).saveConfiguration(userId, input)
}

export async function discoverModels(userId: string, input: DiscoverModelsInput) {
	return (await getDefaultService()).discoverModels(userId, input)
}

export async function streamText(input: TextGenerationInput) {
	return (await getDefaultService()).streamText(input)
}

export async function prepareTextOperation(input: PrepareTextOperationInput) {
	return (await getDefaultService()).prepareTextOperation(input)
}
