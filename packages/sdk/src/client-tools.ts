import { Validator } from "@cfworker/json-schema"
import { asSchema, modelMessageSchema, type Schema, type ToolExecuteFunction, type ToolSet } from "ai"
import { z } from "zod"

import type { ChatServerFrameV1, ClientToolManifest } from "./generated/models"

const ALLOWED_FIELDS = new Set([
	"type",
	"description",
	"inputSchema",
	"outputSchema",
	"strict",
	"inputExamples",
	"execute",
])
const PAYLOAD_BYTES = 262_144
const MANIFEST_BYTES = 131_072
const CLIENT_TOOL_LIMIT = 8
const TOOL_DESCRIPTION_CHARACTERS = 1000
export const CLIENT_TOOL_CALL_LIMIT = 16
const encoder = new TextEncoder()
const jsonSchemaObject = z.record(z.string(), z.unknown())

export type ClientToolRegistry = {
	readonly size: number
	manifest(): Promise<ClientToolManifest>
	execute(request: Extract<ChatServerFrameV1, { type: "tool-call" }>, signal: AbortSignal): Promise<unknown>
}

async function validateValue(schema: Schema<unknown>, value: unknown): Promise<unknown> {
	if (schema.validate) {
		const result = await schema.validate(value)
		if (!result.success) throw new Error("Invalid tool value")
		return result.value
	}
	const validator = new Validator(structuredClone(jsonSchemaObject.parse(await schema.jsonSchema)))
	if (!validator.validate(value).valid) throw new Error("Invalid tool value")
	return value
}

export function jsonValue(value: unknown): string {
	const ancestors = new Set<object>()
	function check(item: unknown): void {
		if (item === null || typeof item === "string" || typeof item === "boolean") return
		if (typeof item === "number" && Number.isFinite(item)) return
		if (typeof item !== "object" || item === null || ancestors.has(item))
			throw new Error("Tool output must be a JSON value")
		if (
			!Array.isArray(item) &&
			Object.getPrototypeOf(item) !== Object.prototype &&
			Object.getPrototypeOf(item) !== null
		)
			throw new Error("Tool output must contain only JSON objects")
		ancestors.add(item)
		if (Array.isArray(item)) {
			for (let index = 0; index < item.length; index++) check(item[index])
		} else {
			if (Object.getOwnPropertySymbols(item).length) throw new Error("Tool output cannot contain symbol keys")
			for (const entry of Object.values(item)) check(entry)
		}
		ancestors.delete(item)
	}
	check(value)
	const serialized = JSON.stringify(value)
	if (encoder.encode(serialized).length > PAYLOAD_BYTES) throw new Error("Tool payload exceeds 256 KiB")
	return serialized
}

export function captureClientTools(definitions: ToolSet = {}): ClientToolRegistry {
	const registry = new Map(Object.entries(definitions).map(([name, definition]) => [name, { ...definition }]))
	if (registry.size > CLIENT_TOOL_LIMIT) throw new Error("Register at most 8 client tools")
	for (const [name, definition] of registry) {
		if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) throw new Error(`Invalid client tool name: ${name}`)
		if (definition.type !== undefined && definition.type !== "function")
			throw new Error(`Unsupported client tool type: ${name}`)
		if (typeof definition.execute !== "function") throw new Error(`Client tool requires execute: ${name}`)
		for (const key of Object.keys(definition))
			if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unsupported client tool field: ${key}`)
		if (
			definition.description !== undefined &&
			(typeof definition.description !== "string" ||
				Array.from(definition.description).length > TOOL_DESCRIPTION_CHARACTERS)
		)
			throw new Error(`Client tool requires a static description of at most 1000 characters: ${name}`)
		if (definition.inputExamples !== undefined && !Array.isArray(definition.inputExamples))
			throw new Error(`Client tool requires static input examples: ${name}`)
	}
	let manifest: Promise<ClientToolManifest> | undefined
	async function resolveManifest(): Promise<ClientToolManifest> {
		const tools = await Promise.all(
			[...registry].map(async ([name, definition]) => ({
				name,
				description: typeof definition.description === "string" ? definition.description : undefined,
				inputSchema: jsonSchemaObject.parse(await asSchema(definition.inputSchema).jsonSchema),
				outputSchema: definition.outputSchema
					? jsonSchemaObject.parse(await asSchema(definition.outputSchema).jsonSchema)
					: undefined,
				strict: definition.strict,
				inputExamples: Array.isArray(definition.inputExamples) ? definition.inputExamples : undefined,
			})),
		)
		for (const definition of tools) {
			jsonValue(definition.inputSchema)
			if (definition.outputSchema) jsonValue(definition.outputSchema)
			if (definition.inputExamples) jsonValue(definition.inputExamples)
		}
		if (encoder.encode(JSON.stringify(tools)).length > MANIFEST_BYTES)
			throw new Error("Client tool manifest exceeds 128 KiB")
		return tools
	}
	return {
		get size() {
			return registry.size
		},
		manifest: () => (manifest ??= resolveManifest()),
		async execute(request: Extract<ChatServerFrameV1, { type: "tool-call" }>, signal: AbortSignal): Promise<unknown> {
			const definition = registry.get(request.toolName)
			if (!definition?.execute) throw new Error("Unknown client tool")
			jsonValue(request.input)
			const validated = await validateValue(asSchema(definition.inputSchema), request.input)
			const messages = request.messages.map((message) => modelMessageSchema.parse(message))
			signal.throwIfAborted()
			// The original schema validates the erased input type before invocation.
			const execute = definition.execute as ToolExecuteFunction<unknown, unknown, unknown>
			const output: unknown = await execute(validated, {
				toolCallId: request.toolCallId,
				messages,
				abortSignal: signal,
				context: undefined,
			})
			jsonValue(output)
			const result = definition.outputSchema ? await validateValue(asSchema(definition.outputSchema), output) : output
			jsonValue(result)
			return result
		},
	}
}
