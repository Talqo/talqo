import type { Annotate } from "@/http/wide-event.ts"

import { env } from "@/config/env.ts"
import { PROBLEM_CODES } from "@/http/problem.ts"
import { isForeignKeyViolation } from "@/lib/pg-error.ts"
import * as agentService from "@/modules/agent/agent.service.ts"
import * as aiProvider from "@/modules/ai-provider/ai-provider.service.ts"
import * as embedService from "@/modules/embed/embed.service.ts"
import * as knowledgeBase from "@/modules/knowledge-base/knowledge-base.service.ts"
import * as mcp from "@/modules/mcp/mcp.service.ts"
import * as roles from "@/modules/roles/roles.service.ts"
import * as usageService from "@/modules/usage/usage.service.ts"
import { asSchema, convertToModelMessages, type ModelMessage, type UIMessage } from "ai"
import { z } from "zod"

import type { ClientToolChannel } from "./conversation.client-tools.ts"
import type { MessagePart } from "./conversation.messages.ts"

import { createBlacklistFilter } from "./blacklist.ts"
import { TOOL_PAYLOAD_BYTES } from "./conversation.client-tools.ts"
import {
	ConversationNotFoundError,
	ConversationTooLongError,
	EmbedDisabledError,
	InvalidChatInputError,
	ProviderUnavailableError,
	SessionBusyError,
	SessionUnauthorizedError,
} from "./conversation.errors.ts"
import { finalizePart } from "./conversation.messages.ts"
import { createGenerationPoller } from "./conversation.poller.ts"
import * as repository from "./conversation.repository.ts"
import {
	GENERATION_ATTEMPT_ACTIVE_STATUSES,
	type GenerationAttemptOutcome,
	type GenerationAttemptStatus,
} from "./conversation.schema.ts"

export type { GenerationAttemptOutcome } from "./conversation.schema.ts"

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
	| { model: string; provider: aiProvider.AiProviderId; type: "start" }
	| { text: string; type: "text" }
	| { type: "step-start" }
	| {
			model: string
			outcome: "cancelled" | "completed" | "failed" | "interrupted"
			provider: aiProvider.AiProviderId
			type: "finish"
			usage: usageService.ProviderUsage
	  }

type PreparedOperation = {
	invoke(
		signal: AbortSignal,
		tools?: aiProvider.ToolBinding,
		onToolEvent?: (event: aiProvider.ToolEvent) => void | Promise<void>,
	): AsyncIterable<GenerationEvent>
	model: string
	provider: aiProvider.AiProviderId
}

type Dependencies = {
	beforeAccept?: (attempt: number) => Promise<void>
	concurrencyLimit: number
	dailyLimit: number
	prepare(input: { maxOutputTokens: number; messages: ModelMessage[]; timeoutMs: number }): Promise<PreparedOperation>
	maxInputCharacters: number
	maxOutputTokens: number
	timeoutMs: number
}

type ChatMessage = {
	requestId?: string
	createdAt: string
	id: string
	outcome: "blocked" | "cancelled" | "completed" | "failed" | "interrupted" | "streaming"
	role: "assistant" | "user"
	text: string
	parts: MessagePart[]
}

export type ChatEvent =
	| {
			version: 1
			assistantMessage: { createdAt: string; id: string }
			generationId: string
			requestId: string
			duplicate?: boolean
			type: "accepted"
			userMessage: { createdAt: string; id: string }
	  }
	| { version: 1; assistantMessageId: string; index: number; text: string; type: "delta" }
	| { version: 1; assistantMessageId: string; index: number; part: MessagePart; type: "part" }
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
			error: { code: ChatErrorCode; newChatAvailable: boolean; retriable: boolean }
			outcome: "failed"
			type: "error"
	  }

type ChatErrorCode = "chat-context-limit" | "chat-input-incompatible" | "provider-error"

type SendInput = {
	cancellationSignal?: AbortSignal
	clientTools?: ClientToolChannel
	clientManifestFingerprint?: string
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
		requestId: message.requestId,
		role: message.role,
		text: message.text,
		parts: message.parts,
		outcome: message.outcome,
		createdAt: message.createdAt.toISOString(),
	}
}

async function completedPrompt(
	systemPrompt: string,
	messages: Awaited<ReturnType<typeof repository.listMessages>>,
	text: string,
) {
	const history: UIMessage[] = []
	for (let index = 0; index < messages.length - 1; index += COMPLETED_PAIR_WIDTH) {
		const user = messages[index]
		const assistant = messages[index + 1]
		if (
			user?.role === "user" &&
			user.outcome === "completed" &&
			assistant?.role === "assistant" &&
			assistant.outcome === "completed"
		) {
			history.push(
				{ id: user.id, role: "user", parts: user.parts },
				{ id: assistant.id, role: "assistant", parts: assistant.parts },
			)
		}
	}
	return [
		{ role: "system" as const, content: systemPrompt },
		...(await convertToModelMessages(history)),
		{ role: "user" as const, content: text },
	]
}

function promptText(messages: ModelMessage[]): string {
	return messages
		.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
		.join("\n")
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
			await repository.pruneDailyCounters()
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
		baseMessages: ModelMessage[],
		initialOperation: PreparedOperation,
		emit: (event: ChatEvent) => void,
		annotate: Annotate,
		clientTools?: ClientToolChannel,
		cancellationSignal?: AbortSignal,
	): Promise<void> {
		let messages = baseMessages
		let prepared = initialOperation
		const { generationAttempt, assistantMessage } = accepted
		if (!(await repository.markRunning(generationAttempt.id, generationAttempt.leaseToken))) {
			annotate({ "chat.lease_lost": true })
			return
		}
		const controller = new AbortController()
		const interrupt = () => controller.abort()
		clientTools?.signal.addEventListener("abort", interrupt, { once: true })
		cancellationSignal?.addEventListener("abort", interrupt, { once: true })
		if (clientTools?.signal.aborted) controller.abort()
		if (cancellationSignal?.aborted) controller.abort()
		poller.register(generationAttempt.id, generationAttempt.leaseToken, controller)
		const filter = createBlacklistFilter(agent.wordBlacklist)
		let observedOutput = ""
		let toolDefinitions = ""
		let bufferedOutput = ""
		let bufferedIndex: number | undefined
		let activeTextIndex: number | undefined
		// Blacklist look-behind can release text after a tool call. Keep each span's original part.
		const textOrigins: { index: number; remaining: number }[] = []
		let flushTimer: ReturnType<typeof setTimeout> | undefined
		let flushing: Promise<void> | undefined
		let outputFailed = false
		const parts: MessagePart[] = []
		let mutations = Promise.resolve()
		function serialize(write: () => Promise<void>): Promise<void> {
			const next = mutations.then(write)
			mutations = next.catch(() => {
				outputFailed = true
				controller.abort()
			})
			return next
		}
		async function persistPart(part: MessagePart, position?: number): Promise<void> {
			await serialize(async () => {
				const index = position ?? parts.length
				parts[index] = part
				if (!(await repository.replaceParts(generationAttempt.id, generationAttempt.leaseToken, parts)))
					throw new Error("Generation lease lost")
				emit({ version: 1, type: "part", assistantMessageId: assistantMessage.id, index, part })
			})
		}
		async function flushOutput(): Promise<void> {
			if (flushing) {
				await flushing
				if (!bufferedOutput) return
			}
			clearTimeout(flushTimer)
			flushTimer = undefined
			if (!bufferedOutput || outputFailed) return
			const text = bufferedOutput
			const index = bufferedIndex
			if (index === undefined) throw new Error("Text output has no part")
			bufferedOutput = ""
			flushing = serialize(async () => {
				if (!(await repository.appendOutput(generationAttempt.id, generationAttempt.leaseToken, text, index))) {
					outputFailed = true
					controller.abort()
					return
				}
				const part = parts[index]
				if (part?.type !== "text") throw new Error("Text output targets a non-text part")
				parts[index] = { ...part, text: part.text + text }
				emit({ version: 1, type: "delta", assistantMessageId: assistantMessage.id, index, text })
			})
			try {
				await flushing
			} finally {
				flushing = undefined
			}
		}
		async function queueOutput(text: string): Promise<void> {
			if (!text || outputFailed) return
			for (let offset = 0; offset < text.length;) {
				const origin = textOrigins[0]
				if (!origin) throw new Error("Filtered output has no source part")
				// oxlint-disable-next-line no-await-in-loop -- the blacklist can release text from earlier parts.
				if (bufferedIndex !== origin.index) await flushOutput()
				bufferedIndex = origin.index
				const length = Math.min(OUTPUT_BATCH_SIZE - bufferedOutput.length, text.length - offset, origin.remaining)
				bufferedOutput += text.slice(offset, offset + length)
				offset += length
				origin.remaining -= length
				if (origin.remaining === 0) textOrigins.shift()
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
		let providerInvoked = false
		let publicError: { code: ChatErrorCode; newChatAvailable: boolean; retriable: boolean } = {
			code: "provider-error",
			retriable: true,
			newChatAvailable: false,
		}
		// Resolves here because abort exists here. Prepare retries would orphan earlier spawns.
		let connection: mcp.OpenTools | undefined
		const inFlight = new Map<string, { serverName: string; toolName: string }>()
		try {
			controller.signal.throwIfAborted()
			let chunks: string[] = []
			try {
				chunks = await knowledgeBase.searchKnowledge(
					agent.id,
					accepted.userMessage.text,
					AbortSignal.any([controller.signal, AbortSignal.timeout(dependencies.timeoutMs)]),
				)
				annotate({ "rag.chunks": chunks.length, "rag.degraded": false })
			} catch (error) {
				if (controller.signal.aborted) throw error
				annotate({ "rag.degraded": true })
				console.error("knowledge-base.retrieval.degraded", { agentId: agent.id, error: String(error) })
			}
			controller.signal.throwIfAborted()
			if (chunks.length) {
				const question = `Use the context below only if relevant to the question, otherwise ignore it.\n${chunks.join("\n---\n")}\n\nQuestion: ${accepted.userMessage.text}`
				messages = [...baseMessages.slice(0, -1), { role: "user", content: question }]
				const promptCharacters = Array.from(promptText(messages)).length
				annotate({ "chat.prompt_characters": promptCharacters })
				if (promptCharacters > dependencies.maxInputCharacters)
					throw new aiProvider.ProviderContextLimitError("Retrieved context exceeds the input limit")
				prepared = await dependencies.prepare({
					messages,
					maxOutputTokens: dependencies.maxOutputTokens,
					timeoutMs: dependencies.timeoutMs,
				})
				provider = prepared.provider
				model = prepared.model
			}
			try {
				connection = await mcp.openTools(agent.id, controller.signal)
				annotate({ "mcp.servers_degraded": connection.degradedServers })
			} catch (error) {
				console.error("mcp.tools.degraded", { agentId: agent.id, error: String(error) })
			}
			const tools: aiProvider.ToolBinding = { names: new Map(connection?.names), tools: { ...connection?.tools } }
			for (const [name, identity] of clientTools?.binding.names ?? []) {
				if (tools.names.has(name)) throw new InvalidChatInputError("Tool name collision")
				tools.names.set(name, identity)
				const definition = clientTools?.binding.tools[name]
				if (!definition) throw new Error("Client tool definition missing")
				tools.tools[name] = definition
			}
			if (Object.keys(tools.tools).length)
				toolDefinitions = JSON.stringify(
					await Promise.all(
						Object.entries(tools.tools).map(async ([name, definition]) => {
							const inputSchema: unknown = await asSchema(definition.inputSchema).jsonSchema
							return { name, description: definition.description, inputSchema, inputExamples: definition.inputExamples }
						}),
					),
				)
			if (Array.from(promptText(messages) + toolDefinitions).length > dependencies.maxInputCharacters)
				throw new aiProvider.ProviderContextLimitError("Tool definitions exceed the input limit")
			controller.signal.throwIfAborted()
			if (
				!(await repository.setAttribution(
					generationAttempt.id,
					generationAttempt.leaseToken,
					provider,
					model,
					true,
					usageService.estimateTokens(promptText(messages) + toolDefinitions),
				))
			) {
				annotate({ "chat.lease_lost": true })
				return
			}
			providerInvoked = true
			for await (const event of prepared.invoke(controller.signal, tools, async (toolEvent) => {
				await flushOutput()
				// Parallel calls to the same tool share a name; only the call id tells them apart.
				const key = toolEvent.toolCallId
				if (toolEvent.type === "tool-start") {
					if (
						toolEvent.identity.source === "client" &&
						Buffer.byteLength(JSON.stringify(toolEvent.input)) > TOOL_PAYLOAD_BYTES
					)
						throw new Error("Client tool input exceeds the payload limit")
					activeTextIndex = undefined
					observedOutput += JSON.stringify(toolEvent.input)
					await persistPart({
						type: "dynamic-tool",
						toolName: toolEvent.toolName,
						toolCallId: key,
						input: toolEvent.input,
						state: "input-available",
						toolMetadata: {
							source: toolEvent.identity.source ?? "mcp",
							displayName: toolEvent.identity.toolName,
							serverName: toolEvent.identity.serverName,
						},
					})
					inFlight.set(key, toolEvent.identity)
					emit({ version: 1, type: "tool-start", ...toolEvent.identity })
				} else {
					observedOutput += JSON.stringify(toolEvent.output ?? toolEvent.errorText)
					const index = parts.findIndex((part) => part.type === "dynamic-tool" && part.toolCallId === key)
					const part = parts[index]
					if (part?.type !== "dynamic-tool" || part.state !== "input-available")
						throw new Error("Tool result without pending invocation")
					if (controller.signal.aborted) {
						const interrupted = clientTools?.interrupted && !cancellationSignal?.aborted
						await persistPart(finalizePart(part, interrupted ? "interrupted" : "cancelled"), index)
						inFlight.delete(key)
						emit({ version: 1, type: "tool-end", ...toolEvent.identity, outcome: "cancelled" })
						return
					}
					await persistPart(
						toolEvent.output !== undefined
							? {
									...part,
									state: "output-available",
									output: toolEvent.output,
									toolMetadata: { ...part.toolMetadata, outcome: toolEvent.outcome },
								}
							: {
									...part,
									state: "output-error",
									errorText: toolEvent.errorText ?? "Tool execution failed",
									toolMetadata: { ...part.toolMetadata, outcome: "failed" },
								},
						index,
					)
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
					if (!event.text) continue
					if (activeTextIndex === undefined) {
						await flushOutput()
						activeTextIndex = parts.length
						await persistPart({ type: "text", text: "" })
					}
					const previousOrigin = textOrigins.at(-1)
					if (previousOrigin?.index === activeTextIndex) previousOrigin.remaining += event.text.length
					else textOrigins.push({ index: activeTextIndex, remaining: event.text.length })
					const result = filter.push(event.text)
					if (result.blocked) {
						outcome = "blocked"
						controller.abort()
						break
					}
					await queueOutput(result.text)
				} else if (event.type === "step-start") {
					await flushOutput()
					activeTextIndex = undefined
					await persistPart({ type: "step-start" })
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
				await mutations
			} finally {
				poller.unregister(generationAttempt.id)
				clientTools?.signal.removeEventListener("abort", interrupt)
				cancellationSignal?.removeEventListener("abort", interrupt)
				await connection?.close()
			}
		}
		if (outputFailed && outcome !== "blocked") outcome = "failed"
		if (clientTools?.interrupted && !cancellationSignal?.aborted) outcome = "interrupted"
		if (clientTools?.dispatched) publicError.retriable = false

		const normalized = providerInvoked
			? usageService.normalizeUsage({
					inputText: promptText(messages) + toolDefinitions,
					outputText: observedOutput,
					usage: providerUsage,
				})
			: { inputTokens: 0, outputTokens: 0 }
		annotate({
			"gen_ai.provider.name": provider,
			"gen_ai.response.model": model,
			"gen_ai.usage.input_tokens": normalized.inputTokens,
			"gen_ai.usage.output_tokens": normalized.outputTokens,
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
				for (const [index, part] of parts.entries()) {
					const finalized = finalizePart(part, outcome)
					if (finalized !== part)
						emit({ version: 1, type: "part", assistantMessageId: assistantMessage.id, index, part: finalized })
				}
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
			} else {
				annotate({ "chat.lease_lost": true })
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
		async send(input: SendInput, emit: (event: ChatEvent) => void = () => {}, annotate: Annotate = () => {}) {
			await recoverUsage()
			if (!input.text) throw new InvalidChatInputError("Message text is required")
			requireUuid(input.requestId, new InvalidChatInputError("Request ID is invalid"))
			annotate({ "chat.request_id": input.requestId })
			const currentEmbed = await embedService.getEmbedByToken(input.embedToken)
			if (currentEmbed.isDisabled) throw new EmbedDisabledError()
			if (Array.from(input.text).length > dependencies.maxInputCharacters) throw new ConversationTooLongError()
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
			annotate({ "chat.new_conversation": !session })
			const agentId = currentEmbed.agentId
			annotate({ "agent.id": agentId, "embed.id": currentEmbed.id })
			const agent = await agentService.getAgent(agentId)
			async function prepareAndAccept(attempt: number): Promise<{
				accepted: repository.AcceptedGenerationAttempt
				messages: ModelMessage[]
				prepared: PreparedOperation
			}> {
				const history = session
					? await repository.getHistorySnapshot(session.conversationId)
					: { messages: [], revision: 0, latestCompletedMessageId: null }
				const systemPrompt = agentService.composeSystemPrompt(agent.systemPrompt)
				const messages = await completedPrompt(systemPrompt, history.messages, input.text)
				const promptContent = promptText(messages)
				const promptCharacters = Array.from(promptContent).length
				annotate({ "chat.prompt_characters": promptCharacters })
				if (promptCharacters > dependencies.maxInputCharacters) throw new ConversationTooLongError()
				let prepared: PreparedOperation
				try {
					prepared = await dependencies.prepare({
						messages,
						maxOutputTokens: dependencies.maxOutputTokens,
						timeoutMs: dependencies.timeoutMs,
					})
				} catch (error) {
					console.error("conversation.provider.unavailable", { agentId, error })
					throw new ProviderUnavailableError("The configured text provider is unavailable", { cause: error })
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
						clientManifestFingerprint: input.clientManifestFingerprint,
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
				duplicate: accepted.duplicate,
				generationId: accepted.generationAttempt.id,
				userMessage: { id: accepted.userMessage.id, createdAt: accepted.userMessage.createdAt.toISOString() },
				assistantMessage: {
					id: accepted.assistantMessage.id,
					createdAt: accepted.assistantMessage.createdAt.toISOString(),
				},
			}
			annotate({ "chat.duplicate": accepted.duplicate })
			emit(acceptedEvent)
			if (accepted.duplicate && !isActiveStatus(accepted.generationAttempt.status)) {
				emit({ version: 1, type: "terminal", outcome: accepted.generationAttempt.status })
			}
			const done = accepted.duplicate
				? Promise.resolve()
				: run(accepted, agent, messages, prepared, emit, annotate, input.clientTools, input.cancellationSignal)
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

export const CONVERSATION_PAGE_SIZE = 25
export const CONVERSATION_PAGE_MAX = 10_000
export const CONVERSATION_AGENT_FILTER_MAX = 100
const CONVERSATION_PREVIEW_LENGTH = 160

type ConversationSummary = {
	agentId: string
	id: string
	messageCount: number
	preview: string | null
	startedAt: string
}

export type ConversationPage = {
	conversations: ConversationSummary[]
	page: number
	pageSize: number
	total: number
}

export type ConversationTranscript = {
	agentId: string
	id: string
	messages: ChatMessage[]
	startedAt: string
}

export async function listConversations(
	filter: { agentId?: string[]; page: number },
	actorId: string,
): Promise<ConversationPage> {
	const scope = await roles.requireAgentScope(actorId, roles.AgentPermission.ConversationsRead)
	let agentIds: string[] | undefined = scope === "all" ? undefined : scope
	if (filter.agentId) {
		agentIds = scope === "all" ? filter.agentId : filter.agentId.filter((id) => scope.includes(id))
	}
	const { rows, total } = await repository.listConversations({
		agentIds,
		limit: CONVERSATION_PAGE_SIZE,
		offset: (filter.page - 1) * CONVERSATION_PAGE_SIZE,
		previewLength: CONVERSATION_PREVIEW_LENGTH,
	})
	return {
		conversations: rows.map((row) => ({
			id: row.referenceId,
			agentId: row.agentId,
			messageCount: row.messageCount,
			preview: row.preview,
			startedAt: row.createdAt.toISOString(),
		})),
		page: filter.page,
		pageSize: CONVERSATION_PAGE_SIZE,
		total,
	}
}

export async function getConversationTranscript(referenceId: string, actorId: string): Promise<ConversationTranscript> {
	await repository.recoverExpiredGenerationAttempts()
	const found = await repository.findConversationByReference(referenceId)
	if (!found) throw new ConversationNotFoundError()
	await roles.requireAgentPermission(
		actorId,
		found.agentId,
		roles.AgentPermission.ConversationsRead,
		PROBLEM_CODES.CONVERSATION_NOT_FOUND,
	)
	return {
		id: found.referenceId,
		agentId: found.agentId,
		startedAt: found.createdAt.toISOString(),
		messages: (await repository.listMessages(found.id)).map(publicMessage),
	}
}
