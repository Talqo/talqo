import { env } from "@/config/env.ts"
import { isForeignKeyViolation } from "@/lib/pg-error.ts"
import * as agentService from "@/modules/agent/agent.service.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.service.ts"
import * as embedService from "@/modules/embed/embed.service.ts"
import * as knowledgeBase from "@/modules/knowledge-base/knowledge-base.service.ts"
import * as mcp from "@/modules/mcp/mcp.service.ts"
import * as usageService from "@/modules/usage/usage.service.ts"
import { z } from "zod"

import { createBlacklistFilter } from "./blacklist.ts"
import {
	ConversationTooLongError,
	InvalidChatInputError,
	ProviderUnavailableError,
	SessionBusyError,
	SessionUnauthorizedError,
} from "./conversation.errors.ts"
import { createGenerationPoller } from "./conversation.poller.ts"
import * as repository from "./conversation.repository.ts"
import {
	GENERATION_ATTEMPT_ACTIVE_STATUSES,
	type GenerationAttemptOutcome,
	type GenerationAttemptStatus,
} from "./conversation.schema.ts"

const COMPLETED_PAIR_WIDTH = 2
const FRESH_PROMPT_MESSAGE_COUNT = 2
const MILLISECONDS_PER_SECOND = 1000
const MAX_HISTORY_ACCEPT_ATTEMPTS = 3
const USAGE_FINALIZATION_BATCH = 20
const USAGE_FINALIZATION_CONCURRENCY = 5
const RECOVERY_INTERVAL_MS = 5_000
const OUTPUT_BATCH_SIZE = 1_024
const OUTPUT_FLUSH_MS = 100
const UUID_SCHEMA = z.uuid({ version: "v4" })

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
	invoke(
		signal: AbortSignal,
		tools?: aiProvider.ToolBinding,
		onToolEvent?: (event: aiProvider.ToolEvent) => void,
	): AsyncIterable<GenerationEvent>
	model: string
	provider: string
}

type Dependencies = {
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

type ChatMessage = {
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
			generationId: string
			requestId: string
			type: "accepted"
			userMessage: { createdAt: string; id: string }
	  }
	| { version: 1; assistantMessageId: string; text: string; type: "delta" }
	| { version: 1; outcome: "blocked" | "cancelled" | "completed" | "failed" | "interrupted"; type: "terminal" }
	| { version: 1; serverName: string; toolName: string; type: "tool-start" }
	| {
			version: 1
			outcome: "cancelled" | "completed" | "failed"
			serverName: string
			toolName: string
			type: "tool-end"
	  }
	| {
			version: 1
			error: { code: string; newChatAvailable: boolean; retriable: boolean }
			outcome: "failed"
			type: "error"
	  }

type SendInput = {
	credential: string
	embedToken: string
	networkHash: string
	requestId: string
	text: string
}

function requireUuid(value: string, error: Error): string {
	if (!UUID_SCHEMA.safeParse(value).success) throw error
	return value
}

function isActiveStatus(
	status: GenerationAttemptStatus,
): status is (typeof GENERATION_ATTEMPT_ACTIVE_STATUSES)[number] {
	return GENERATION_ATTEMPT_ACTIVE_STATUSES.some((active) => active === status)
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
	prompt.push({ role: "user", content: text })
	return prompt
}

function promptText(messages: aiProvider.TextMessage[]): string {
	return messages.map((message) => message.content).join("\n")
}

async function recordPendingUsage(pending: repository.PendingUsageFinalization): Promise<void> {
	const normalized =
		pending.inputTokens === null || pending.outputTokens === null
			? {
					inputTokens: pending.estimatedInputTokens,
					outputTokens: usageService.estimateTokens(pending.assistantText),
				}
			: { inputTokens: pending.inputTokens, outputTokens: pending.outputTokens }
	if (pending.inputTokens === null || pending.outputTokens === null) {
		await repository.stageRecoveredUsageCandidate(
			pending.generationAttemptId,
			pending.outcome,
			normalized.inputTokens,
			normalized.outputTokens,
		)
	}
	try {
		await usageService.recordUsage({
			generationAttemptId: pending.generationAttemptId,
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
		generationAttemptId: pending.generationAttemptId,
		outcome: pending.outcome,
		...normalized,
	})
}

async function authenticate(credential: string): Promise<repository.ConversationContext> {
	const session = await repository.findConversationById(
		requireUuid(credential, new SessionUnauthorizedError("A valid session credential is required")),
	)
	if (!session) throw new SessionUnauthorizedError("Session is invalid or revoked")
	return session
}

export function createConversationService(dependencies: Dependencies) {
	const poller = createGenerationPoller()
	let lastRecovery = -Infinity
	let recovering: Promise<void> | undefined
	async function recoverUsage(): Promise<void> {
		if (recovering) return recovering
		if (performance.now() - lastRecovery < RECOVERY_INTERVAL_MS) return
		recovering = (async () => {
			const pending = await repository.listPendingUsageFinalizations(USAGE_FINALIZATION_BATCH)
			for (let offset = 0; offset < pending.length; offset += USAGE_FINALIZATION_CONCURRENCY) {
				// oxlint-disable-next-line no-await-in-loop -- bounded recovery must finish each group before starting another.
				await Promise.all(pending.slice(offset, offset + USAGE_FINALIZATION_CONCURRENCY).map(recordPendingUsage))
			}
			lastRecovery = performance.now()
		})()
		try {
			await recovering
		} finally {
			recovering = undefined
		}
	}

	async function run(
		accepted: repository.AcceptedGenerationAttempt,
		agent: agentService.Agent,
		messages: aiProvider.TextMessage[],
		prepared: PreparedOperation,
		emit: (event: ChatEvent) => void,
	): Promise<void> {
		const { generationAttempt, assistantMessage } = accepted
		if (!(await repository.markRunning(generationAttempt.id, generationAttempt.leaseToken))) return
		const controller = new AbortController()
		poller.register(generationAttempt.id, generationAttempt.leaseToken, controller)
		const filter = createBlacklistFilter(agent.wordBlacklist)
		let observedOutput = ""
		let bufferedOutput = ""
		let flushTimer: ReturnType<typeof setTimeout> | undefined
		let flushing: Promise<void> | undefined
		let outputFailed = false
		async function flushOutput(): Promise<void> {
			if (flushing) {
				await flushing
				if (!bufferedOutput) return
			}
			clearTimeout(flushTimer)
			flushTimer = undefined
			if (!bufferedOutput || outputFailed) return
			const text = bufferedOutput
			bufferedOutput = ""
			flushing = (async () => {
				if (!(await repository.appendOutput(generationAttempt.id, generationAttempt.leaseToken, text))) {
					outputFailed = true
					controller.abort()
					return
				}
				emit({ version: 1, type: "delta", assistantMessageId: assistantMessage.id, text })
			})()
			try {
				await flushing
			} finally {
				flushing = undefined
			}
		}
		async function queueOutput(text: string): Promise<void> {
			if (!text || outputFailed) return
			for (let offset = 0; offset < text.length;) {
				const length = Math.min(OUTPUT_BATCH_SIZE - bufferedOutput.length, text.length - offset)
				bufferedOutput += text.slice(offset, offset + length)
				offset += length
				// oxlint-disable-next-line no-await-in-loop -- writes must preserve provider text order.
				if (bufferedOutput.length >= OUTPUT_BATCH_SIZE) await flushOutput()
				if (outputFailed) return
			}
			if (bufferedOutput && !flushTimer) {
				flushTimer = setTimeout(() => {
					void flushOutput().catch(() => {
						outputFailed = true
						controller.abort()
					})
				}, OUTPUT_FLUSH_MS)
			}
		}
		let outcome: GenerationAttemptOutcome = "failed"
		let provider = prepared.provider
		let model = prepared.model
		let providerUsage: usageService.ProviderUsage | undefined
		let terminalObserved = false
		let publicError = {
			code: "provider-error",
			retriable: true,
			newChatAvailable: false,
		}
		// Resolves here because abort exists here. Prepare retries would orphan earlier spawns.
		let connection: mcp.OpenTools | undefined
		try {
			connection = await mcp.openTools(agent.id, controller.signal)
		} catch (error) {
			console.error("mcp.tools.degraded", { agentId: agent.id, error: String(error) })
		}
		const inFlight = new Map<string, { serverName: string; toolName: string }>()
		try {
			if (
				!(await repository.setAttribution(generationAttempt.id, generationAttempt.leaseToken, provider, model, true))
			) {
				return
			}
			for await (const event of prepared.invoke(controller.signal, connection, (toolEvent) => {
				// Parallel calls to the same tool share a name; only the call id tells them apart.
				const key = toolEvent.toolCallId
				if (toolEvent.type === "tool-start") {
					inFlight.set(key, toolEvent.identity)
					emit({ version: 1, type: "tool-start", ...toolEvent.identity })
				} else {
					inFlight.delete(key)
					emit({ version: 1, type: "tool-end", ...toolEvent.identity, outcome: toolEvent.outcome })
				}
			})) {
				if (event.type === "start") {
					provider = event.provider
					model = event.model
					await repository.setAttribution(generationAttempt.id, generationAttempt.leaseToken, provider, model)
				} else if (event.type === "text") {
					observedOutput += event.text
					const result = filter.push(event.text)
					if (result.blocked) {
						outcome = "blocked"
						controller.abort()
						break
					}
					await queueOutput(result.text)
				} else {
					const abortPrecededTerminal = controller.signal.aborted
					provider = event.provider
					model = event.model
					providerUsage = event.usage
					outcome = abortPrecededTerminal ? "cancelled" : event.outcome
					terminalObserved = true
					break
				}
			}
			if (controller.signal.aborted && outcome !== "blocked" && !terminalObserved) {
				outcome = "cancelled"
			}
		} catch (error) {
			if (!terminalObserved) outcome = controller.signal.aborted ? "cancelled" : "failed"
			if (error instanceof aiProvider.ProviderContextLimitError) {
				const establishedConversation = messages.length > FRESH_PROMPT_MESSAGE_COUNT
				publicError = establishedConversation
					? {
							code: "chat-context-limit",
							retriable: false,
							newChatAvailable: true,
						}
					: {
							code: "chat-input-incompatible",
							retriable: false,
							newChatAvailable: false,
						}
			}
		} finally {
			// An abort never reaches the provider's own callback, so unresolved calls close here.
			for (const identity of inFlight.values()) {
				emit({ version: 1, type: "tool-end", ...identity, outcome: "cancelled" })
			}
			inFlight.clear()
			clearTimeout(flushTimer)
			try {
				if (outcome !== "blocked") await queueOutput(filter.finish())
				await flushOutput()
			} finally {
				poller.unregister(generationAttempt.id)
				await connection?.close()
			}
		}
		if (outputFailed && outcome !== "blocked") outcome = "failed"

		const normalized = usageService.normalizeUsage({
			inputText: promptText(messages),
			outputText: observedOutput,
			usage: providerUsage,
		})
		try {
			if (
				await repository.stageFinalization({
					generationAttemptId: generationAttempt.id,
					leaseToken: generationAttempt.leaseToken,
					provider,
					model,
					outcome,
					...normalized,
				})
			) {
				const [pending] = await repository.listPendingUsageFinalizations(1, generationAttempt.id)
				if (pending) await recordPendingUsage(pending)
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
		} catch (error) {
			console.error("conversation.finalization.failed", {
				generationAttemptId: generationAttempt.id,
				error: error instanceof Error ? error.message : error,
			})
			emit({ version: 1, type: "error", outcome: "failed", error: publicError })
		}
	}

	return {
		async send(input: SendInput, emit: (event: ChatEvent) => void = () => {}) {
			await recoverUsage()
			if (!input.text) throw new InvalidChatInputError("Message text is required")
			requireUuid(input.requestId, new InvalidChatInputError("Request ID is invalid"))
			const currentEmbed = await embedService.getEmbedByToken(input.embedToken)
			const conversationId = requireUuid(
				input.credential,
				new SessionUnauthorizedError("A valid session credential is required"),
			)
			const session = await repository.findConversationById(conversationId)
			if (
				session &&
				(session.embedId !== currentEmbed.id || session.embedAccessVersion !== currentEmbed.accessVersion)
			) {
				throw new SessionUnauthorizedError("Session does not belong to this embed")
			}
			const agentId = currentEmbed.agentId
			const agent = await agentService.getAgent(agentId)
			async function prepareAndAccept(attempt: number): Promise<{
				accepted: repository.AcceptedGenerationAttempt
				messages: aiProvider.TextMessage[]
				prepared: PreparedOperation
			}> {
				const history = session
					? await repository.getHistorySnapshot(session.conversationId)
					: { messages: [], revision: 0, latestCompletedMessageId: null }
				const systemPrompt = agentService.composeSystemPrompt(agent.systemPrompt)
				let question = input.text
				try {
					const chunks = await knowledgeBase.searchKnowledge(agentId, input.text)
					if (chunks.length) {
						question = `Use the context below only if relevant to the question, otherwise ignore it.\n${chunks.join("\n---\n")}\n\nQuestion: ${input.text}`
					}
				} catch (error) {
					console.error("knowledge-base.retrieval.degraded", { agentId, error: String(error) })
				}
				const messages = completedPrompt(systemPrompt, history.messages, question)
				const promptContent = promptText(messages)
				if ([...promptContent].length > dependencies.maxInputCharacters) throw new ConversationTooLongError()
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
					const accepted = await repository.acceptGenerationAttempt({
						agentId,
						conversationId,
						embedAccessVersion: currentEmbed.accessVersion,
						embedId: currentEmbed.id,
						requestId: input.requestId,
						historyRevision: history.revision,
						historyTailId: history.latestCompletedMessageId,
						estimatedInputTokens: usageService.estimateTokens(promptContent),
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
					throw error
				}
			}
			const { accepted, messages, prepared } = await prepareAndAccept(0)
			const acceptedEvent: ChatEvent = {
				version: 1,
				type: "accepted",
				requestId: input.requestId,
				generationId: accepted.generationAttempt.id,
				userMessage: { id: accepted.userMessage.id, createdAt: accepted.userMessage.createdAt.toISOString() },
				assistantMessage: {
					id: accepted.assistantMessage.id,
					createdAt: accepted.assistantMessage.createdAt.toISOString(),
				},
			}
			emit(acceptedEvent)
			if (accepted.duplicate && !isActiveStatus(accepted.generationAttempt.status)) {
				emit({ version: 1, type: "terminal", outcome: accepted.generationAttempt.status })
			}
			const done = accepted.duplicate ? Promise.resolve() : run(accepted, agent, messages, prepared, emit)
			return { ...acceptedEvent, duplicate: accepted.duplicate, done }
		},

		async getSession(credential: string) {
			await repository.recoverExpiredGenerationAttempts()
			await recoverUsage()
			const session = await authenticate(credential)
			return {
				messages: (await repository.listMessages(session.conversationId)).map(publicMessage),
				activeGeneration: await repository.getActiveGenerationAttempt(session.conversationId),
			}
		},

		async cancel(credential: string, generationId?: string): Promise<void> {
			const session = await authenticate(credential)
			const matched = await repository.requestCancellation(session.conversationId, generationId)
			for (const id of matched) poller.abort(id)
		},
	}
}

export {
	getActiveConversationCountsByAgent,
	getDailyConversationCountsByAgent,
	getDailyMessageCountsByAgent,
} from "./conversation.repository.ts"

let defaultService: ReturnType<typeof createConversationService> | undefined

export function getConversationService() {
	return (defaultService ??= createConversationService({
		dailyLimit: env.TALQO_CHAT_DAILY_MESSAGE_LIMIT,
		concurrencyLimit: env.TALQO_CHAT_MAX_CONCURRENT_GENERATIONS_PER_IP,
		maxInputCharacters: env.TALQO_CHAT_MAX_INPUT_CHARACTERS,
		maxOutputTokens: env.TALQO_CHAT_MAX_OUTPUT_TOKENS,
		timeoutMs: env.TALQO_CHAT_GENERATION_TIMEOUT_SECONDS * MILLISECONDS_PER_SECOND,
		prepare: (input) => aiProvider.prepareTextOperation(input),
	}))
}
