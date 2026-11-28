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
import { PAGE_TOOL_NAME, TOOL_PAYLOAD_BYTES } from "./conversation.client-tools.ts"
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
import { CANCELLATION_REASON, createGenerationPoller } from "./conversation.poller.ts"
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
const RECOVERY_INTERVAL_MS = 5000
const OUTPUT_BATCH_SIZE = 1024
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
	prepare(input: {
		maxOutputTokens: number
		messages: Array<ModelMessage>
		timeoutMs: number
	}): Promise<PreparedOperation>
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
	parts: Array<MessagePart>
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

function validateMessage(input: SendInput): void {
	if (!input.text) throw new InvalidChatInputError("Message text is required")
	requireUuid(input.requestId, new InvalidChatInputError("Request ID is invalid"))
}

function pageApprovalInstructions(
	clientTools: SendInput["clientTools"],
	pageControl: { enabled: boolean; approvalInstructions: string },
): string | undefined {
	if (!clientTools) return undefined
	for (const [name, identity] of clientTools.binding.names) {
		if (identity.toolName !== PAGE_TOOL_NAME) continue
		if (pageControl.enabled) return pageControl.approvalInstructions
		clientTools.binding.names.delete(name)
		delete clientTools.binding.tools[name]
	}
	return undefined
}

function isActiveStatus(
	status: GenerationAttemptStatus,
): status is (typeof GENERATION_ATTEMPT_ACTIVE_STATUSES)[number] {
	return GENERATION_ATTEMPT_ACTIVE_STATUSES.some((active) => active === status)
}

type StoredMessage = Awaited<ReturnType<typeof repository.listMessages>>[number]

function publicMessage(message: StoredMessage): ChatMessage {
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

function isCompletedExchange(user: StoredMessage, assistant: StoredMessage): boolean {
	return user.outcome === "completed" && assistant.outcome === "completed"
}

async function completedPrompt(
	systemPrompt: string,
	messages: Awaited<ReturnType<typeof repository.listMessages>>,
	text: string,
) {
	const history: Array<UIMessage> = []
	for (let index = 0; index < messages.length - 1; index += COMPLETED_PAIR_WIDTH) {
		const user = messages[index]
		const assistant = messages[index + 1]
		if (user?.role === "user" && assistant?.role === "assistant" && isCompletedExchange(user, assistant)) {
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

function promptText(messages: Array<ModelMessage>): string {
	return messages
		.map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
		.join("\n")
}

const DEFAULT_PUBLIC_ERROR: { code: ChatErrorCode; newChatAvailable: boolean; retriable: boolean } = {
	code: "provider-error",
	retriable: true,
	newChatAvailable: false,
}

async function retrieveContext(input: {
	agentId: string
	annotate: Annotate
	question: string
	signal: AbortSignal
	timeoutMs: number
}): Promise<Array<string>> {
	try {
		const chunks = await knowledgeBase.searchKnowledge(
			input.agentId,
			input.question,
			AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]),
		)
		input.annotate({ "rag.chunks": chunks.length, "rag.degraded": false })
		return chunks
	} catch (error) {
		if (input.signal.aborted) throw error
		input.annotate({ "rag.degraded": true })
		console.error("knowledge-base.retrieval.degraded", { agentId: input.agentId, error: String(error) })
		return []
	}
}

async function applyRetrievedContext(input: {
	annotate: Annotate
	baseMessages: Array<ModelMessage>
	chunks: Array<string>
	initialOperation: PreparedOperation
	maxInputCharacters: number
	maxOutputTokens: number
	prepare: Dependencies["prepare"]
	question: string
	timeoutMs: number
}): Promise<{ messages: Array<ModelMessage>; prepared: PreparedOperation }> {
	if (input.chunks.length === 0) return { messages: input.baseMessages, prepared: input.initialOperation }
	const question = `Use the context below only if relevant to the question, otherwise ignore it.\n${input.chunks.join("\n---\n")}\n\nQuestion: ${input.question}`
	const messages = [...input.baseMessages.slice(0, -1), { role: "user" as const, content: question }]
	const promptCharacters = Array.from(promptText(messages)).length
	input.annotate({ "chat.prompt_characters": promptCharacters })
	if (promptCharacters > input.maxInputCharacters) {
		throw new aiProvider.ProviderContextLimitError("Retrieved context exceeds the input limit")
	}
	const prepared = await input.prepare({
		messages,
		maxOutputTokens: input.maxOutputTokens,
		timeoutMs: input.timeoutMs,
	})
	return { messages, prepared }
}

async function openGenerationTools(
	agentId: string,
	signal: AbortSignal,
	annotate: Annotate,
): Promise<mcp.OpenTools | undefined> {
	try {
		const connection = await mcp.openTools(agentId, signal)
		annotate({ "mcp.servers_degraded": connection.degradedServers })
		return connection
	} catch (error) {
		console.error("mcp.tools.degraded", { agentId, error: String(error) })
		return undefined
	}
}

function completedToolPart(
	part: Extract<MessagePart, { type: "dynamic-tool"; state: "input-available" }>,
	toolEvent: Extract<aiProvider.ToolEvent, { type: "tool-end" }>,
): MessagePart {
	return toolEvent.output !== undefined
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
			}
}

function mergeClientTools(
	tools: aiProvider.ToolBinding,
	clientTools: ClientToolChannel,
	publicMessages: Array<ModelMessage>,
): void {
	for (const [name, identity] of clientTools.binding.names) {
		if (tools.names.has(name)) throw new InvalidChatInputError("Tool name collision")
		tools.names.set(name, identity)
		const definition = clientTools.binding.tools[name]
		if (!definition?.execute) throw new Error("Client tool definition missing")
		const execute = definition.execute
		// Browser tools receive the public transcript, not the enriched provider prompt.
		tools.tools[name] = {
			...definition,
			execute: async (toolInput, options): Promise<unknown> => {
				const output: unknown = await execute(toolInput, { ...options, messages: publicMessages })
				return output
			},
		}
	}
}

async function createGenerationTools(input: {
	clientTools: ClientToolChannel | undefined
	connection: mcp.OpenTools | undefined
	publicMessages: Array<ModelMessage>
}): Promise<{ toolDefinitions: string; tools: aiProvider.ToolBinding }> {
	const tools: aiProvider.ToolBinding = input.connection
		? { names: new Map(input.connection.names), tools: { ...input.connection.tools } }
		: { names: new Map(), tools: {} }
	if (input.clientTools) mergeClientTools(tools, input.clientTools, input.publicMessages)
	if (Object.keys(tools.tools).length === 0) return { tools, toolDefinitions: "" }
	const toolDefinitions = JSON.stringify(
		await Promise.all(
			Object.entries(tools.tools).map(async ([name, definition]) => {
				const inputSchema: unknown = await asSchema(definition.inputSchema).jsonSchema
				return { name, description: definition.description, inputSchema, inputExamples: definition.inputExamples }
			}),
		),
	)
	return { tools, toolDefinitions }
}

function combineAbortSignals(
	controller: AbortController,
	clientTools: ClientToolChannel | undefined,
	cancellationSignal: AbortSignal | undefined,
): AbortSignal {
	const signals = [controller.signal]
	if (clientTools) signals.push(clientTools.signal)
	if (cancellationSignal) signals.push(cancellationSignal)
	return AbortSignal.any(signals)
}

function applyConnectionOutcome(
	stream: StreamedGeneration,
	clientTools: ClientToolChannel | undefined,
	isCancelled: () => boolean,
	publicError: { retriable: boolean },
): void {
	stream.outcome = outputFailureOutcome(stream.outcome, stream.outputFailed)
	if (clientTools?.interrupted && !isCancelled()) stream.outcome = "interrupted"
	if (clientTools?.dispatched) publicError.retriable = false
}

function finalizeStreamOutcome(
	outcome: GenerationAttemptOutcome,
	aborted: boolean,
	terminalObserved: boolean,
): GenerationAttemptOutcome {
	if (aborted && outcome !== "blocked" && !terminalObserved) return "cancelled"
	return outcome
}

function outputFailureOutcome(outcome: GenerationAttemptOutcome, failed: boolean): GenerationAttemptOutcome {
	return failed && outcome !== "blocked" ? "failed" : outcome
}

function failedOutcome(
	current: GenerationAttemptOutcome,
	aborted: boolean,
	terminalObserved: boolean,
): GenerationAttemptOutcome {
	if (terminalObserved) return current
	return aborted ? "cancelled" : "failed"
}

function publicFailure(
	error: unknown,
	messageCount: number,
): { code: ChatErrorCode; newChatAvailable: boolean; retriable: boolean } {
	if (!(error instanceof aiProvider.ProviderContextLimitError)) return { ...DEFAULT_PUBLIC_ERROR }
	if (messageCount > FRESH_PROMPT_MESSAGE_COUNT) {
		return { code: "chat-context-limit", retriable: false, newChatAvailable: true }
	}
	return { code: "chat-input-incompatible", retriable: false, newChatAvailable: false }
}

type StreamedGeneration = {
	model: string
	outcome: GenerationAttemptOutcome
	outputFailed: boolean
	outputText: string
	provider: aiProvider.AiProviderId
	terminalObserved: boolean
	usage: usageService.ProviderUsage | undefined
}

async function streamGeneration(input: {
	accepted: repository.AcceptedGenerationAttempt
	annotate: Annotate
	assistantMessageId: string
	clientTools: ClientToolChannel | undefined
	controller: AbortController
	emit: (event: ChatEvent) => void
	filter: ReturnType<typeof createBlacklistFilter>
	parts: Array<MessagePart>
	prepared: PreparedOperation
	signal: AbortSignal
	state: StreamedGeneration
	tools: aiProvider.ToolBinding
}): Promise<void> {
	const { state } = input
	let toolCalls = 0
	let toolFailures = 0
	let bufferedOutput = ""
	let bufferedIndex: number | undefined
	let activeTextIndex: number | undefined
	// Blacklist look-behind can release text after a tool call. Keep each span's original part.
	const textOrigins: Array<{ index: number; remaining: number }> = []
	let flushTimer: ReturnType<typeof setTimeout> | undefined
	let flushing: Promise<void> | undefined
	let mutations = Promise.resolve()
	function isCancelled(): boolean {
		return input.controller.signal.reason === CANCELLATION_REASON
	}
	function serialize(write: () => Promise<void>): Promise<void> {
		const next = mutations.then(write)
		mutations = next.catch(() => {
			state.outputFailed = true
			input.controller.abort()
		})
		return next
	}
	async function persistPart(part: MessagePart, position?: number): Promise<void> {
		await serialize(async () => {
			const index = position ?? input.parts.length
			if (
				!(await repository.putPart(
					input.accepted.generationAttempt.id,
					input.accepted.generationAttempt.leaseToken,
					index,
					part,
				))
			)
				throw new Error("Generation lease lost")
			input.parts[index] = part
			input.emit({ version: 1, type: "part", assistantMessageId: input.assistantMessageId, index, part })
		})
	}
	async function flushOutput(): Promise<void> {
		if (flushing) {
			await flushing
			if (!bufferedOutput) return
		}
		clearTimeout(flushTimer)
		flushTimer = undefined
		if (!bufferedOutput || state.outputFailed) return
		const text = bufferedOutput
		const index = bufferedIndex
		if (index === undefined) throw new Error("Text output has no part")
		bufferedOutput = ""
		flushing = serialize(async () => {
			if (
				!(await repository.appendOutput(
					input.accepted.generationAttempt.id,
					input.accepted.generationAttempt.leaseToken,
					text,
					index,
				))
			) {
				state.outputFailed = true
				input.controller.abort()
				return
			}
			const part = input.parts[index]
			if (part?.type !== "text") throw new Error("Text output targets a non-text part")
			input.parts[index] = { ...part, text: part.text + text }
			input.emit({ version: 1, type: "delta", assistantMessageId: input.assistantMessageId, index, text })
		})
		try {
			await flushing
		} finally {
			flushing = undefined
		}
	}
	function scheduleOutputFlush(): void {
		if (!bufferedOutput || flushTimer) return
		flushTimer = setTimeout(() => {
			void flushOutput().catch(() => {
				state.outputFailed = true
				input.controller.abort()
			})
		}, OUTPUT_FLUSH_MS)
	}

	async function queueChunk(text: string, offset: number): Promise<number> {
		const origin = textOrigins[0]
		if (!origin) throw new Error("Filtered output has no source part")
		if (bufferedIndex !== origin.index) await flushOutput()
		bufferedIndex = origin.index
		const length = Math.min(OUTPUT_BATCH_SIZE - bufferedOutput.length, text.length - offset, origin.remaining)
		bufferedOutput += text.slice(offset, offset + length)
		origin.remaining -= length
		if (origin.remaining === 0) textOrigins.shift()
		if (bufferedOutput.length >= OUTPUT_BATCH_SIZE) await flushOutput()
		return offset + length
	}

	async function queueOutput(text: string): Promise<void> {
		if (!text || state.outputFailed) return
		for (let offset = 0; offset < text.length;) {
			offset = await queueChunk(text, offset)
			if (state.outputFailed) return
		}
		scheduleOutputFlush()
	}

	async function startTool(toolEvent: Extract<aiProvider.ToolEvent, { type: "tool-start" }>): Promise<void> {
		if (
			toolEvent.identity.source === "client" &&
			Buffer.byteLength(JSON.stringify(toolEvent.input)) > TOOL_PAYLOAD_BYTES
		)
			throw new Error("Client tool input exceeds the payload limit")
		activeTextIndex = undefined
		state.outputText += JSON.stringify(toolEvent.input)
		await persistPart({
			type: "dynamic-tool",
			toolName: toolEvent.toolName,
			toolCallId: toolEvent.toolCallId,
			input: toolEvent.input,
			state: "input-available",
			toolMetadata: {
				source: toolEvent.identity.source ?? "mcp",
				displayName: toolEvent.identity.toolName,
				serverName: toolEvent.identity.serverName,
			},
		})
		input.annotate({ "chat.tool_calls": ++toolCalls })
	}

	function interruptedStatus(): "cancelled" | "interrupted" {
		return input.clientTools?.interrupted === true && !isCancelled() ? "interrupted" : "cancelled"
	}

	async function endTool(toolEvent: Extract<aiProvider.ToolEvent, { type: "tool-end" }>): Promise<void> {
		state.outputText += JSON.stringify(toolEvent.output ?? toolEvent.errorText)
		const index = input.parts.findIndex(
			(part) => part.type === "dynamic-tool" && part.toolCallId === toolEvent.toolCallId,
		)
		const part = input.parts[index]
		if (part?.type !== "dynamic-tool" || part.state !== "input-available")
			throw new Error("Tool result without pending invocation")
		if (input.signal.aborted) {
			await persistPart(finalizePart(part, interruptedStatus()), index)
			return
		}
		await persistPart(completedToolPart(part, toolEvent), index)
		if (toolEvent.outcome === "failed") input.annotate({ "chat.tool_failures": ++toolFailures })
	}

	async function handleToolEvent(toolEvent: aiProvider.ToolEvent): Promise<void> {
		await flushOutput()
		// Parallel calls to the same tool share a name; only the call id tells them apart.
		if (toolEvent.type === "tool-start") await startTool(toolEvent)
		else await endTool(toolEvent)
	}

	async function handleTextEvent(event: Extract<GenerationEvent, { type: "text" }>): Promise<boolean> {
		state.outputText += event.text
		if (!event.text) return false
		if (activeTextIndex === undefined) {
			await flushOutput()
			activeTextIndex = input.parts.length
			await persistPart({ type: "text", text: "" })
		}
		const previousOrigin = textOrigins.at(-1)
		if (previousOrigin?.index === activeTextIndex) previousOrigin.remaining += event.text.length
		else textOrigins.push({ index: activeTextIndex, remaining: event.text.length })
		const result = input.filter.push(event.text)
		if (result.blocked) {
			state.outcome = "blocked"
			input.controller.abort()
			return true
		}
		await queueOutput(result.text)
		return false
	}

	async function handleStepStartEvent(): Promise<void> {
		await flushOutput()
		activeTextIndex = undefined
		await persistPart({ type: "step-start" })
	}

	function applyFinishEvent(event: Extract<GenerationEvent, { type: "finish" }>): void {
		const abortPrecededTerminal = input.signal.aborted
		state.provider = event.provider
		state.model = event.model
		state.usage = event.usage
		state.outcome = abortPrecededTerminal ? "cancelled" : event.outcome
		state.terminalObserved = true
	}

	async function handleGenerationEvent(event: GenerationEvent): Promise<boolean> {
		if (event.type === "start") {
			state.provider = event.provider
			state.model = event.model
			await repository.setAttribution(
				input.accepted.generationAttempt.id,
				input.accepted.generationAttempt.leaseToken,
				state.provider,
				state.model,
			)
			return false
		}
		if (event.type === "text") return handleTextEvent(event)
		if (event.type === "step-start") {
			await handleStepStartEvent()
			return false
		}
		applyFinishEvent(event)
		return true
	}

	try {
		for await (const event of input.prepared.invoke(input.signal, input.tools, handleToolEvent)) {
			if (await handleGenerationEvent(event)) break
		}
	} finally {
		clearTimeout(flushTimer)
		try {
			if (state.outcome !== "blocked") await queueOutput(input.filter.finish())
			await flushOutput()
			await mutations
		} finally {
			state.outcome = finalizeStreamOutcome(state.outcome, input.signal.aborted, state.terminalObserved)
		}
	}
}

async function recordFinalizedUsage(generationAttemptId: string): Promise<void> {
	const [pending] = await repository.listPendingUsageFinalizations(1, generationAttemptId)
	if (pending) await recordPendingUsage(pending)
}

function emitCompletion(
	emit: (event: ChatEvent) => void,
	outcome: GenerationAttemptOutcome,
	publicError: { code: ChatErrorCode; newChatAvailable: boolean; retriable: boolean },
): void {
	if (outcome === "failed") emit({ version: 1, type: "error", outcome, error: publicError })
	else emit({ version: 1, type: "terminal", outcome })
}

async function finalizeGeneration(input: {
	accepted: repository.AcceptedGenerationAttempt
	annotate: Annotate
	assistantMessageId: string
	emit: (event: ChatEvent) => void
	messages: Array<ModelMessage>
	model: string
	outcome: GenerationAttemptOutcome
	outputText: string
	parts: Array<MessagePart>
	provider: aiProvider.AiProviderId
	providerInvoked: boolean
	providerUsage: usageService.ProviderUsage | undefined
	publicError: { code: ChatErrorCode; newChatAvailable: boolean; retriable: boolean }
	toolDefinitions: string
}): Promise<void> {
	const normalized = input.providerInvoked
		? usageService.normalizeUsage({
				inputText: promptText(input.messages) + input.toolDefinitions,
				outputText: input.outputText,
				usage: input.providerUsage,
			})
		: { inputTokens: 0, outputTokens: 0 }
	input.annotate({
		"gen_ai.provider.name": input.provider,
		"gen_ai.response.model": input.model,
		"gen_ai.usage.input_tokens": normalized.inputTokens,
		"gen_ai.usage.output_tokens": normalized.outputTokens,
	})
	try {
		const staged = await repository.stageFinalization({
			generationAttemptId: input.accepted.generationAttempt.id,
			leaseToken: input.accepted.generationAttempt.leaseToken,
			provider: input.provider,
			model: input.model,
			outcome: input.outcome,
			...normalized,
		})
		if (!staged) {
			input.annotate({ "chat.lease_lost": true })
			return
		}
		for (const [index, part] of input.parts.entries()) {
			const finalized = finalizePart(part, input.outcome)
			if (finalized !== part)
				input.emit({ version: 1, type: "part", assistantMessageId: input.assistantMessageId, index, part: finalized })
		}
		await recordFinalizedUsage(input.accepted.generationAttempt.id)
		emitCompletion(input.emit, input.outcome, input.publicError)
	} catch (error) {
		console.error("conversation.finalization.failed", {
			generationAttemptId: input.accepted.generationAttempt.id,
			error: error instanceof Error ? error.message : error,
		})
		input.emit({ version: 1, type: "error", outcome: "failed", error: input.publicError })
	}
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

async function findMatchingSession(
	conversationId: string,
	embed: { accessVersion: number; id: string },
): Promise<repository.ConversationContext | undefined> {
	const session = await repository.findConversationById(conversationId)
	if (session && (session.embedId !== embed.id || session.embedAccessVersion !== embed.accessVersion)) {
		throw new SessionUnauthorizedError("Session does not belong to this embed")
	}
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
			// Finalize one bounded group at a time to limit database load.
			for (let offset = 0; offset < pending.length; offset += USAGE_FINALIZATION_CONCURRENCY) {
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
		baseMessages: Array<ModelMessage>,
		initialOperation: PreparedOperation,
		emit: (event: ChatEvent) => void,
		annotate: Annotate,
		clientTools?: ClientToolChannel,
		cancellationSignal?: AbortSignal,
	): Promise<void> {
		const { generationAttempt, assistantMessage } = accepted
		if (!(await repository.markRunning(generationAttempt.id, generationAttempt.leaseToken))) {
			annotate({ "chat.lease_lost": true })
			return
		}
		const controller = new AbortController()
		const signal = combineAbortSignals(controller, clientTools, cancellationSignal)
		function isCancelled(): boolean {
			return cancellationSignal?.aborted === true || controller.signal.reason === CANCELLATION_REASON
		}
		poller.register(generationAttempt.id, generationAttempt.leaseToken, controller)
		const filter = createBlacklistFilter(agent.wordBlacklist)
		let messages = baseMessages
		let prepared = initialOperation
		const parts: Array<MessagePart> = []
		const stream: StreamedGeneration = {
			outcome: "failed",
			provider: prepared.provider,
			model: prepared.model,
			outputFailed: false,
			outputText: "",
			terminalObserved: false,
			usage: undefined,
		}
		let providerInvoked = false
		let publicError: { code: ChatErrorCode; newChatAvailable: boolean; retriable: boolean } = {
			...DEFAULT_PUBLIC_ERROR,
		}
		// Resolves here because abort exists here. Prepare retries would orphan earlier spawns.
		let connection: mcp.OpenTools | undefined
		let toolDefinitions = ""
		try {
			signal.throwIfAborted()
			const chunks = await retrieveContext({
				agentId: agent.id,
				annotate,
				question: accepted.userMessage.text,
				signal,
				timeoutMs: dependencies.timeoutMs,
			})
			signal.throwIfAborted()
			const applied = await applyRetrievedContext({
				annotate,
				baseMessages,
				chunks,
				initialOperation,
				maxInputCharacters: dependencies.maxInputCharacters,
				maxOutputTokens: dependencies.maxOutputTokens,
				prepare: (input) => dependencies.prepare(input),
				question: accepted.userMessage.text,
				timeoutMs: dependencies.timeoutMs,
			})
			messages = applied.messages
			prepared = applied.prepared
			stream.provider = prepared.provider
			stream.model = prepared.model
			connection = await openGenerationTools(agent.id, signal, annotate)
			signal.throwIfAborted()
			const publicMessages = baseMessages.filter((message) => message.role !== "system")
			const generationTools = await createGenerationTools({ clientTools, connection, publicMessages })
			toolDefinitions = generationTools.toolDefinitions
			if (Array.from(promptText(messages) + toolDefinitions).length > dependencies.maxInputCharacters)
				throw new aiProvider.ProviderContextLimitError("Tool definitions exceed the input limit")
			signal.throwIfAborted()
			if (
				!(await repository.setAttribution(
					generationAttempt.id,
					generationAttempt.leaseToken,
					stream.provider,
					stream.model,
					true,
					usageService.estimateTokens(promptText(messages) + toolDefinitions),
				))
			) {
				annotate({ "chat.lease_lost": true })
				return
			}
			providerInvoked = true
			await streamGeneration({
				accepted,
				annotate,
				assistantMessageId: assistantMessage.id,
				clientTools,
				controller,
				emit,
				filter,
				parts,
				prepared,
				signal,
				state: stream,
				tools: generationTools.tools,
			})
		} catch (error) {
			stream.outcome = failedOutcome(stream.outcome, signal.aborted, stream.terminalObserved)
			publicError = publicFailure(error, messages.length)
		} finally {
			poller.unregister(generationAttempt.id)
			await connection?.close()
		}
		applyConnectionOutcome(stream, clientTools, isCancelled, publicError)
		await finalizeGeneration({
			accepted,
			annotate,
			assistantMessageId: assistantMessage.id,
			emit,
			messages,
			model: stream.model,
			outcome: stream.outcome,
			outputText: stream.outputText,
			parts,
			provider: stream.provider,
			providerInvoked,
			providerUsage: stream.usage,
			publicError,
			toolDefinitions,
		})
	}

	function startGeneration(
		accepted: repository.AcceptedGenerationAttempt,
		agent: agentService.Agent,
		messages: Array<ModelMessage>,
		prepared: PreparedOperation,
		emit: (event: ChatEvent) => void,
		annotate: Annotate,
		clientTools?: ClientToolChannel,
		cancellationSignal?: AbortSignal,
	): Promise<void> {
		return accepted.duplicate
			? Promise.resolve()
			: run(accepted, agent, messages, prepared, emit, annotate, clientTools, cancellationSignal)
	}

	return {
		async send(input: SendInput, emit: (event: ChatEvent) => void = () => {}, annotate: Annotate = () => {}) {
			await recoverUsage()
			validateMessage(input)
			annotate({ "chat.request_id": input.requestId })
			const currentEmbed = await embedService.getEmbedByToken(input.embedToken)
			if (currentEmbed.isDisabled) throw new EmbedDisabledError()
			const agent = await agentService.getAgent(currentEmbed.agentId)
			const approvalInstructions = pageApprovalInstructions(input.clientTools, agent.pageControl)
			if (Array.from(input.text).length > dependencies.maxInputCharacters) throw new ConversationTooLongError()
			const conversationId = requireUuid(
				input.credential,
				new SessionUnauthorizedError("A valid session credential is required"),
			)
			const session = await findMatchingSession(conversationId, currentEmbed)
			annotate({ "chat.new_conversation": !session })
			const agentId = currentEmbed.agentId
			annotate({ "agent.id": agentId, "embed.id": currentEmbed.id })
			async function preparePrompt() {
				const history = session
					? await repository.getHistorySnapshot(session.conversationId)
					: { messages: [], revision: 0, latestCompletedMessageId: null }
				const systemPrompt = agentService.composeSystemPrompt(agent.systemPrompt)
				const instructions = approvalInstructions
					? `${systemPrompt}\n\nWebsite action approval rules:\n${approvalInstructions}`
					: systemPrompt
				const messages = await completedPrompt(instructions, history.messages, input.text)
				const promptContent = promptText(messages)
				const promptCharacters = Array.from(promptContent).length
				annotate({ "chat.prompt_characters": promptCharacters })
				if (promptCharacters > dependencies.maxInputCharacters) throw new ConversationTooLongError()
				return { history, messages, promptContent }
			}
			async function prepareAndAccept(attempt: number): Promise<{
				accepted: repository.AcceptedGenerationAttempt
				messages: Array<ModelMessage>
				prepared: PreparedOperation
			}> {
				const { history, messages, promptContent } = await preparePrompt()
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
			const done = startGeneration(
				accepted,
				agent,
				messages,
				prepared,
				emit,
				annotate,
				input.clientTools,
				input.cancellationSignal,
			)
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

		async authorizePageResume(credential: string, embedToken: string): Promise<void> {
			const session = await authenticate(credential)
			const currentEmbed = await embedService.getEmbedByToken(embedToken)
			if (session.embedId !== currentEmbed.id)
				throw new SessionUnauthorizedError("Session does not belong to this embed")
			const agent = await agentService.getAgent(currentEmbed.agentId)
			if (currentEmbed.isDisabled || !agent.pageControl.enabled) throw new EmbedDisabledError()
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
	conversations: Array<ConversationSummary>
	page: number
	pageSize: number
	total: number
}

export type ConversationTranscript = {
	agentId: string
	id: string
	messages: Array<ChatMessage>
	startedAt: string
}

export async function listConversations(
	filter: { agentId?: Array<string>; page: number },
	actorId: string,
): Promise<ConversationPage> {
	const scope = await roles.requireAgentScope(actorId, roles.AgentPermission.ConversationsRead)
	let agentIds: Array<string> | undefined = scope === "all" ? undefined : scope
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
