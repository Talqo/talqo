import { env } from "@/config/env.ts"
import { isForeignKeyViolation } from "@/lib/pg-error.ts"
import * as agentService from "@/modules/agent/agent.service.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.service.ts"
import {
	BOOTSTRAP_SECRET_BYTES,
	hashSecret,
	isCanonicalBase64Url,
	REQUEST_ID_BYTES,
} from "@/modules/conversation/conversation-crypto.ts"
import * as embedService from "@/modules/embed/embed.service.ts"
import * as usageService from "@/modules/usage/usage.service.ts"

import { createBlacklistFilter } from "./blacklist.ts"
import { deriveSessionCredential } from "./conversation-crypto.ts"
import * as repository from "./conversation.repository.ts"

const CANCELLATION_POLL_MS = 500
const HEARTBEAT_MS = 5_000
const COMPLETED_PAIR_WIDTH = 2
const FRESH_PROMPT_MESSAGE_COUNT = 2
const MILLISECONDS_PER_SECOND = 1000
const MAX_HISTORY_ACCEPT_ATTEMPTS = 3

export const PUBLIC_PATH_PATTERNS = [/^\/api\/chat(?:\/.*)?$/] as const

type GenerationEvent =
	| { model: string; provider: string; type: "start" }
	| { text: string; type: "text" }
	| {
			model: string
			outcome: "cancelled" | "completed" | "failed" | "interrupted"
			provider: string
			type: "finish"
			usage: usageService.ProviderUsage
	  }

type PreparedOperation = {
	invoke(signal: AbortSignal): AsyncIterable<GenerationEvent>
	model: string
	provider: string
}

type Dependencies = {
	appSecret: string
	beforeAccept?: (attempt: number) => Promise<void>
	concurrencyLimit: number
	dailyLimit: number
	prepare(input: {
		maxOutputTokens: number
		messages: aiProvider.TextMessage[]
		timeoutMs: number
	}): Promise<PreparedOperation>
	maxInputCharacters: number
	maxOutputTokens: number
	timeoutMs: number
}

export type ChatMessage = {
	createdAt: string
	id: string
	outcome: "blocked" | "cancelled" | "completed" | "failed" | "interrupted" | "streaming"
	role: "assistant" | "user"
	text: string
}

export type ChatEvent =
	| {
			version: 1
			assistantMessage: { createdAt: string; id: string }
			credential?: string
			generationId: string
			requestId: string
			type: "accepted"
			userMessage: { createdAt: string; id: string }
	  }
	| { version: 1; assistantMessageId: string; text: string; type: "delta" }
	| { version: 1; outcome: "blocked" | "cancelled" | "completed" | "failed" | "interrupted"; type: "terminal" }
	| {
			version: 1
			error: { code: string; message: string; newChatAvailable: boolean; retriable: boolean }
			outcome: "failed"
			type: "error"
	  }

type SendInput = {
	bootstrapSecret?: string
	credential?: string
	embedToken?: string
	networkHash: string
	requestId: string
	text: string
}

export class SessionUnauthorizedError extends Error {}
export class RequestConflictError extends Error {}
export class ConversationTooLongError extends Error {}
export class DailyAllowanceExceededError extends Error {}
export class ConcurrentGenerationLimitError extends Error {}
export class SessionBusyError extends Error {}
export class InvalidChatInputError extends Error {}
export class ProviderUnavailableError extends Error {}

function requireToken(value: string | undefined, bytes: number, name: string): string {
	if (!value || !isCanonicalBase64Url(value, bytes)) throw new InvalidChatInputError(`${name} is invalid`)
	return value
}

function publicMessage(message: Awaited<ReturnType<typeof repository.listMessages>>[number]): ChatMessage {
	return {
		id: message.id,
		role: message.role,
		text: message.text,
		outcome: message.outcome,
		createdAt: message.createdAt.toISOString(),
	}
}

function completedPrompt(
	systemPrompt: string,
	messages: Awaited<ReturnType<typeof repository.listMessages>>,
	text: string,
) {
	const prompt: aiProvider.TextMessage[] = [{ role: "system", content: systemPrompt }]
	for (let index = 0; index < messages.length - 1; index += COMPLETED_PAIR_WIDTH) {
		const user = messages[index]
		const assistant = messages[index + 1]
		if (
			user?.role === "user" &&
			user.outcome === "completed" &&
			assistant?.role === "assistant" &&
			assistant.outcome === "completed"
		) {
			prompt.push({ role: "user", content: user.text }, { role: "assistant", content: assistant.text })
		}
	}
	// TODO(knowledge): Include retrieved knowledge in model input and usage accounting.
	// TODO(mcp): Include MCP tool inputs/results in model input and usage accounting.
	prompt.push({ role: "user", content: text })
	return prompt
}

function promptText(messages: aiProvider.TextMessage[]): string {
	return messages.map((message) => message.content).join("\n")
}

async function drainPendingUsageFinalizations(): Promise<void> {
	await Promise.all(
		(await repository.listPendingUsageFinalizations()).map(async (pending) => {
			const normalized =
				pending.inputTokens === null || pending.outputTokens === null
					? usageService.normalizeUsage({ inputText: pending.inputText, outputText: pending.assistantText })
					: { inputTokens: pending.inputTokens, outputTokens: pending.outputTokens }
			if (pending.inputTokens === null || pending.outputTokens === null) {
				await repository.stageRecoveredUsageCandidate(
					pending.attemptId,
					pending.outcome,
					normalized.inputTokens,
					normalized.outputTokens,
				)
			}
			try {
				await usageService.recordUsage({
					attemptId: pending.attemptId,
					agentId: pending.agentId,
					conversationId: pending.conversationId,
					provider: pending.provider,
					model: pending.model,
					outcome: pending.outcome,
					...normalized,
				})
			} catch (error) {
				if (isForeignKeyViolation(error)) return
				throw error
			}
			await repository.markUsageRecorded({
				attemptId: pending.attemptId,
				outcome: pending.outcome,
				...normalized,
			})
		}),
	)
}

async function recoverExpiredAttempts(): Promise<void> {
	await repository.recoverExpired()
	await drainPendingUsageFinalizations()
}

export function createConversationService(dependencies: Dependencies) {
	const controllers = new Map<string, AbortController>()

	async function authenticate(credential: string | undefined): Promise<repository.SessionContext> {
		if (!credential || !isCanonicalBase64Url(credential, BOOTSTRAP_SECRET_BYTES)) {
			throw new SessionUnauthorizedError("A valid bearer session credential is required")
		}
		const session = await repository.findSessionByCredentialHash(hashSecret(credential))
		if (!session) throw new SessionUnauthorizedError("Session is invalid or revoked")
		return session
	}

	async function run(
		accepted: repository.AcceptedAttempt,
		agent: agentService.Agent,
		messages: aiProvider.TextMessage[],
		prepared: PreparedOperation,
		emit: (event: ChatEvent) => void,
	): Promise<void> {
		const { attempt, assistantMessage } = accepted
		if (!(await repository.markRunning(attempt.id, attempt.leaseToken))) return
		const controller = new AbortController()
		controllers.set(attempt.id, controller)
		const filter = createBlacklistFilter(agent.wordBlacklist)
		let observedOutput = ""
		let lastHeartbeat = Date.now()
		let outcome: "blocked" | "cancelled" | "completed" | "failed" | "interrupted" = "failed"
		let provider = prepared.provider
		let model = prepared.model
		let providerUsage: usageService.ProviderUsage | undefined
		let publicError = {
			code: "provider-error",
			message: "The configured model could not complete the response.",
			retriable: true,
			newChatAvailable: false,
		}
		const poll = setInterval(async () => {
			try {
				if (await repository.isCancellationRequested(attempt.id, attempt.leaseToken)) controller.abort()
				if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
					if (!(await repository.heartbeat(attempt.id, attempt.leaseToken))) controller.abort()
					lastHeartbeat = Date.now()
				}
			} catch {
				controller.abort()
			}
		}, CANCELLATION_POLL_MS)
		try {
			if (!(await repository.markProviderInvoked(attempt.id, attempt.leaseToken, provider, model))) return
			for await (const event of prepared.invoke(controller.signal)) {
				if (event.type === "start") {
					provider = event.provider
					model = event.model
					await repository.setAttribution(attempt.id, attempt.leaseToken, provider, model)
				} else if (event.type === "text") {
					observedOutput += event.text
					const result = filter.push(event.text)
					if (result.blocked) {
						outcome = "blocked"
						controller.abort()
						break
					}
					if (result.text && (await repository.appendOutput(attempt.id, attempt.leaseToken, result.text))) {
						emit({ version: 1, type: "delta", assistantMessageId: assistantMessage.id, text: result.text })
					}
				} else {
					provider = event.provider
					model = event.model
					providerUsage = event.usage
					outcome = event.outcome
				}
			}
			if (controller.signal.aborted && outcome !== "blocked") {
				outcome = "cancelled"
			}
		} catch (error) {
			outcome = controller.signal.aborted ? "cancelled" : "failed"
			if (error instanceof aiProvider.ProviderContextLimitError) {
				const establishedConversation = messages.length > FRESH_PROMPT_MESSAGE_COUNT
				publicError = establishedConversation
					? {
							code: "chat-context-limit",
							message: "The complete conversation exceeds the model context limit.",
							retriable: false,
							newChatAvailable: true,
						}
					: {
							code: "chat-input-incompatible",
							message: "The prompt and message are incompatible with the configured model context.",
							retriable: false,
							newChatAvailable: false,
						}
			}
		} finally {
			clearInterval(poll)
			controllers.delete(attempt.id)
		}
		if (outcome !== "blocked") {
			const tail = filter.finish()
			if (tail && (await repository.appendOutput(attempt.id, attempt.leaseToken, tail))) {
				emit({ version: 1, type: "delta", assistantMessageId: assistantMessage.id, text: tail })
			}
		}

		const normalized = usageService.normalizeUsage({
			inputText: promptText(messages),
			outputText: observedOutput,
			usage: providerUsage,
		})
		if (
			await repository.stageFinalization({
				attemptId: attempt.id,
				leaseToken: attempt.leaseToken,
				provider,
				model,
				outcome,
				...normalized,
			})
		) {
			await drainPendingUsageFinalizations()
			if (outcome === "failed") {
				emit({
					version: 1,
					type: "error",
					outcome,
					error: publicError,
				})
			} else {
				emit({ version: 1, type: "terminal", outcome })
			}
		}
	}

	return {
		async send(input: SendInput, emit: (event: ChatEvent) => void = () => {}) {
			await drainPendingUsageFinalizations()
			if (!input.text) throw new InvalidChatInputError("Message text is required")
			requireToken(input.requestId, REQUEST_ID_BYTES, "Request ID")
			let session: repository.SessionContext | undefined
			let credential: string | undefined
			let bootstrap:
				| {
						bootstrapRequestId: string
						bootstrapSecretHash: string
						credentialHash: string
						embedAccessVersion: number
						embedId: string
				  }
				| undefined
			let agentId: string
			if (input.credential) {
				session = await authenticate(input.credential)
				agentId = session.agentId
			} else {
				if (!input.embedToken) {
					throw new InvalidChatInputError("First send requires an embed token and bootstrap secret")
				}
				const bootstrapSecret = requireToken(input.bootstrapSecret, BOOTSTRAP_SECRET_BYTES, "Bootstrap secret")
				const embed = await embedService.getEmbedByToken(input.embedToken)
				agentId = embed.agentId
				credential = deriveSessionCredential(dependencies.appSecret, {
					embedId: embed.id,
					accessVersion: embed.accessVersion,
					requestId: input.requestId,
					bootstrapSecret,
				})
				bootstrap = {
					embedId: embed.id,
					embedAccessVersion: embed.accessVersion,
					bootstrapRequestId: input.requestId,
					bootstrapSecretHash: hashSecret(bootstrapSecret),
					credentialHash: hashSecret(credential),
				}
			}
			const agent = await agentService.getAgent(agentId)
			async function prepareAndAccept(attempt: number): Promise<{
				accepted: repository.AcceptedAttempt
				messages: aiProvider.TextMessage[]
				prepared: PreparedOperation
			}> {
				const history = session
					? await repository.getHistorySnapshot(session.conversationId)
					: { messages: [], revision: 0, latestCompletedMessageId: null }
				const messages = completedPrompt(agent.systemPrompt, history.messages, input.text)
				if ([...promptText(messages)].length > dependencies.maxInputCharacters) throw new ConversationTooLongError()
				let prepared: PreparedOperation
				try {
					prepared = await dependencies.prepare({
						messages,
						maxOutputTokens: dependencies.maxOutputTokens,
						timeoutMs: dependencies.timeoutMs,
					})
				} catch {
					throw new ProviderUnavailableError("The configured text provider is unavailable")
				}
				await dependencies.beforeAccept?.(attempt)
				try {
					const accepted = await repository.acceptAttempt({
						agentId,
						bootstrap,
						conversationId: session?.conversationId,
						sessionId: session?.sessionId,
						requestId: input.requestId,
						requestTextHash: hashSecret(input.text),
						historyRevision: history.revision,
						historyTailId: history.latestCompletedMessageId,
						inputText: promptText(messages),
						messageText: input.text,
						networkHash: input.networkHash,
						dailyLimit: dependencies.dailyLimit,
						concurrencyLimit: dependencies.concurrencyLimit,
					})
					return { accepted, messages, prepared }
				} catch (error) {
					if (error instanceof repository.StaleHistoryRepositoryError) {
						if (attempt + 1 < MAX_HISTORY_ACCEPT_ATTEMPTS) return prepareAndAccept(attempt + 1)
						throw new SessionBusyError("Conversation history changed repeatedly")
					}
					if (error instanceof repository.AllowanceExceededRepositoryError) throw new DailyAllowanceExceededError()
					if (error instanceof repository.ConcurrencyExceededRepositoryError) throw new ConcurrentGenerationLimitError()
					if (error instanceof repository.SessionBusyRepositoryError) throw new SessionBusyError()
					if (error instanceof repository.BootstrapUnauthorizedRepositoryError) throw new SessionUnauthorizedError()
					if (error instanceof repository.RequestConflictRepositoryError) throw new RequestConflictError()
					throw error
				}
			}
			const { accepted, messages, prepared } = await prepareAndAccept(0)
			await drainPendingUsageFinalizations()
			if (accepted.attempt.requestTextHash !== hashSecret(input.text)) throw new RequestConflictError()
			const acceptedEvent: ChatEvent = {
				version: 1,
				type: "accepted",
				requestId: input.requestId,
				generationId: accepted.attempt.id,
				...(credential ? { credential } : {}),
				userMessage: { id: accepted.userMessage.id, createdAt: accepted.userMessage.createdAt.toISOString() },
				assistantMessage: {
					id: accepted.assistantMessage.id,
					createdAt: accepted.assistantMessage.createdAt.toISOString(),
				},
			}
			emit(acceptedEvent)
			if (accepted.duplicate && accepted.attempt.status !== "accepted" && accepted.attempt.status !== "running") {
				emit({ version: 1, type: "terminal", outcome: accepted.attempt.status })
			}
			const done = accepted.duplicate ? Promise.resolve() : run(accepted, agent, messages, prepared, emit)
			return { ...acceptedEvent, duplicate: accepted.duplicate, done }
		},

		async recoverBootstrap(input: { bootstrapSecret: string; embedToken: string; requestId: string }) {
			requireToken(input.requestId, REQUEST_ID_BYTES, "Request ID")
			const bootstrapSecret = requireToken(input.bootstrapSecret, BOOTSTRAP_SECRET_BYTES, "Bootstrap secret")
			let embed: embedService.Embed
			try {
				embed = await embedService.getEmbedByToken(input.embedToken)
			} catch (error) {
				if (error instanceof embedService.EmbedNotFoundError) return { status: "unavailable" as const }
				throw error
			}
			const session = await repository.findBootstrap(embed.id, embed.accessVersion, input.requestId)
			if (!session) return { status: "not-accepted" as const }
			if (session.bootstrapSecretHash !== hashSecret(bootstrapSecret)) {
				throw new SessionUnauthorizedError("Bootstrap secret does not match")
			}
			return {
				status: "accepted" as const,
				credential: deriveSessionCredential(dependencies.appSecret, {
					embedId: embed.id,
					accessVersion: embed.accessVersion,
					requestId: input.requestId,
					bootstrapSecret,
				}),
			}
		},

		async getSession(credential: string) {
			await recoverExpiredAttempts()
			const session = await authenticate(credential)
			return {
				messages: (await repository.listMessages(session.conversationId)).map(publicMessage),
				activeGeneration: await repository.getActiveAttempt(session.sessionId),
			}
		},

		async cancel(credential: string, generationId?: string): Promise<void> {
			const session = await authenticate(credential)
			await repository.requestCancellation(session.sessionId, generationId)
			if (generationId) controllers.get(generationId)?.abort()
		},

		async cancelBootstrap(input: { bootstrapSecret: string; embedToken: string; requestId: string }) {
			requireToken(input.requestId, REQUEST_ID_BYTES, "Request ID")
			const bootstrapSecret = requireToken(input.bootstrapSecret, BOOTSTRAP_SECRET_BYTES, "Bootstrap secret")
			let embed: embedService.Embed
			try {
				embed = await embedService.getEmbedByToken(input.embedToken)
			} catch (error) {
				if (error instanceof embedService.EmbedNotFoundError) return "not-accepted" as const
				throw error
			}
			try {
				const result = await repository.requestBootstrapCancellation({
					embedId: embed.id,
					embedAccessVersion: embed.accessVersion,
					requestId: input.requestId,
					bootstrapSecretHash: hashSecret(bootstrapSecret),
				})
				if (result.attemptId) controllers.get(result.attemptId)?.abort()
				return result.status
			} catch (error) {
				if (error instanceof repository.BootstrapUnauthorizedRepositoryError) throw new SessionUnauthorizedError()
				throw error
			}
		},

		async getAttempt(credential: string, generationId: string) {
			await recoverExpiredAttempts()
			const session = await authenticate(credential)
			const attempt = await repository.getAttempt(session.sessionId, generationId)
			if (!attempt) throw new SessionUnauthorizedError("Generation does not belong to this session")
			return attempt
		},
	}
}

let defaultService: ReturnType<typeof createConversationService> | undefined

export function getConversationService() {
	return (defaultService ??= createConversationService({
		appSecret: env.APP_SECRET,
		dailyLimit: env.TALQO_CHAT_DAILY_MESSAGE_LIMIT,
		concurrencyLimit: env.TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP,
		maxInputCharacters: env.TALQO_CHAT_MAX_INPUT_CHARACTERS,
		maxOutputTokens: env.TALQO_CHAT_MAX_OUTPUT_TOKENS,
		timeoutMs: env.TALQO_CHAT_GENERATION_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND,
		prepare: (input) => aiProvider.prepareTextOperation(input),
	}))
}
