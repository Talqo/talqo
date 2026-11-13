import type { ToolBinding } from "@/modules/ai-provider/ai-provider.service.ts"

import { jsonSchema, type ModelMessage, tool, type ToolExecutionOptions } from "ai"
import { createHash } from "node:crypto"

export const CLIENT_TOOL_LIMIT = 8
export const CLIENT_TOOL_CALL_LIMIT = 16
export const TOOL_PAYLOAD_BYTES = 262_144
export const MANIFEST_BYTES = 131_072
export const TOOL_DESCRIPTION_CHARACTERS = 1000
const TOOL_NAME_HASH_CHARACTERS = 32

export type ClientToolDefinition = {
	name: string
	description?: string
	inputSchema: Record<string, unknown>
	outputSchema?: Record<string, unknown>
	strict?: boolean
	inputExamples?: { input: unknown }[]
}
export type ClientToolRequest = {
	version: 1
	type: "tool-call"
	toolCallId: string
	toolName: string
	input: unknown
	messages: ModelMessage[]
}
export type ClientToolResult = { toolCallId: string } & (
	{ output: unknown; error?: never } | { error: string; output?: never }
)

export type ClientToolChannel = {
	binding: ToolBinding
	signal: AbortSignal
	readonly interrupted: boolean
	readonly dispatched: boolean
	interrupt(): void
	accept(result: ClientToolResult): void
}

export function createClientToolChannel(
	definitions: ClientToolDefinition[],
	dispatch: (request: ClientToolRequest) => void,
	maxContextCharacters: number,
): ClientToolChannel {
	const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; cleanup(): void }>()
	const received = new Map<string, string>()
	let calls = 0
	let interrupted = false
	const controller = new AbortController()
	function interrupt() {
		interrupted = true
		controller.abort(new Error("Client connection interrupted"))
		for (const call of pending.values()) {
			call.cleanup()
			call.reject(new Error("Client connection interrupted"))
		}
		pending.clear()
	}
	const binding: ToolBinding = { names: new Map(), tools: {} }
	for (const definition of definitions) {
		const name = `client_${createHash("sha256").update(definition.name).digest("hex").slice(0, TOOL_NAME_HASH_CHARACTERS)}`
		binding.names.set(name, { source: "client", serverName: "", toolName: definition.name })
		binding.tools[name] = tool({
			description: definition.description,
			inputSchema: jsonSchema(definition.inputSchema),
			strict: definition.strict,
			inputExamples: definition.inputExamples,
			execute: async (input: unknown, options: ToolExecutionOptions<unknown>) => {
				if (++calls > CLIENT_TOOL_CALL_LIMIT) throw new Error("Client tool call limit reached")
				if (interrupted) throw new Error("Client connection interrupted")
				if (Buffer.byteLength(JSON.stringify(input)) > TOOL_PAYLOAD_BYTES) throw new Error("Tool input too large")
				const { toolCallId, abortSignal, messages } = options
				if (Array.from(JSON.stringify(messages)).length > maxContextCharacters)
					throw new Error("Tool execution context too large")
				abortSignal?.throwIfAborted()
				return new Promise<unknown>((resolve, reject) => {
					const abort = () => {
						pending.delete(toolCallId)
						reject(new Error("Tool execution cancelled"))
					}
					const cleanup = () => abortSignal?.removeEventListener("abort", abort)
					pending.set(toolCallId, { resolve, reject, cleanup })
					abortSignal?.addEventListener("abort", abort, { once: true })
					try {
						dispatch({
							version: 1,
							type: "tool-call",
							toolCallId,
							toolName: definition.name,
							input,
							messages: messages.filter((message) => message.role !== "system"),
						})
					} catch (error) {
						pending.delete(toolCallId)
						cleanup()
						reject(error)
					}
				})
			},
		})
	}
	return {
		binding,
		signal: controller.signal,
		get interrupted() {
			return interrupted
		},
		get dispatched() {
			return calls > 0
		},
		interrupt,
		accept(result: ClientToolResult) {
			const serialized = JSON.stringify(result)
			if (result.error === undefined && Buffer.byteLength(JSON.stringify(result.output)) > TOOL_PAYLOAD_BYTES)
				throw new Error("Tool result too large")
			const previous = received.get(result.toolCallId)
			if (previous === serialized) return
			if (previous !== undefined) throw new Error("Conflicting tool result")
			const call = pending.get(result.toolCallId)
			if (!call) throw new Error("Unknown tool call")
			received.set(result.toolCallId, serialized)
			pending.delete(result.toolCallId)
			call.cleanup()
			if (result.error !== undefined) call.reject(new Error(result.error))
			else call.resolve(result.output)
		},
	}
}
