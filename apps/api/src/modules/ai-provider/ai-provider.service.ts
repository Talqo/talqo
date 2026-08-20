import type { DiscoverModelsInput, SaveConfigurationInput } from "./ai-provider.contract.ts"
import type { StoredConfiguration, StoredEmbeddingConfiguration, StoredTextConfiguration } from "./ai-provider.types.ts"
import type { CredentialEnvelope, createCredentialVault } from "./credential-vault.ts"

import { validateConfigurationInput } from "./ai-provider.configuration.ts"
import { discoverModels as discoverProviderModels } from "./ai-provider.discovery.ts"
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

type ServiceDependencies = {
	authorize(userId: string): Promise<boolean>
	discover(input: DiscoverModelsInput): Promise<string[]>
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

function sameContext(
	stored: StoredTextConfiguration,
	input: { authMode: StoredTextConfiguration["authMode"]; providerId: string; settings: Record<string, string> },
): boolean {
	return (
		stored.providerId === input.providerId &&
		stored.authMode === input.authMode &&
		JSON.stringify(stored.settings) === JSON.stringify(input.settings)
	)
}

function requiredCredentialsPresent(providerId: string, credentials: Record<string, string>): boolean {
	return getProviderDefinition(providerId).requiredCredentialFields.every((field) => credentials[field]?.trim())
}

function resolveEnvelope(
	input: {
		credentials?: Record<string, string>
		existing?: StoredTextConfiguration
		existingCredentials?: boolean
		providerId: string
		role: "text" | "embedding"
		settings: Record<string, string>
		authMode: "static" | "deployment-identity"
	},
	vault: Vault,
): CredentialEnvelope | null {
	if (input.authMode === "deployment-identity") return null
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
			let credentials = input.credentials
			if (!credentials && input.storedCredentialRole) {
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
			return dependencies.discover({ ...input, credentials })
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
			authorize: (userId) => roles.authorize(userId, "ai_provider:manage"),
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

export async function createRuntimeModels() {
	return (await getDefaultService()).createRuntimeModels()
}
