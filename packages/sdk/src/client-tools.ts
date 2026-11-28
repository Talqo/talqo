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
export const CLIENT_TOOL_LIMIT = 8
const TOOL_DESCRIPTION_CHARACTERS = 4096
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
export const CLIENT_TOOL_CALL_LIMIT = 16
const encoder = new TextEncoder()
const jsonSchemaObject = z.record(z.string(), z.unknown())
const jsonValueSchema = z.json()

export type ClientToolRegistry = {
	readonly size: number
	manifest(): Promise<ClientToolManifest>
	execute(request: Extract<ChatServerFrameV1, { type: "tool-call" }>, signal: AbortSignal): Promise<unknown>
}

async function validateValue(schema: Schema<unknown>, value: unknown): Promise<unknown> {
	const result = await schema.validate?.(value)
	if (!result?.success) throw new Error("Invalid tool value")
	return result.value
}

export function jsonValue(value: unknown): string {
	const serialized = JSON.stringify(jsonValueSchema.parse(value))
	if (encoder.encode(serialized).length > PAYLOAD_BYTES) throw new Error("Tool payload exceeds 256 KiB")
	return serialized
}

function hasValidator(schema: Parameters<typeof asSchema>[0]): boolean {
	return typeof asSchema(schema).validate === "function"
}

function validateSchemas(name: string, definition: ToolSet[string]): void {
	if (
		!hasValidator(definition.inputSchema) ||
		(definition.outputSchema !== undefined && !hasValidator(definition.outputSchema))
	)
		throw new Error(`Client tool schema requires a validator: ${name}`)
}

function isInvalidDescription(description: unknown): boolean {
	if (description === undefined) return false
	return typeof description !== "string" || Array.from(description).length > TOOL_DESCRIPTION_CHARACTERS
}

function validateFields(name: string, definition: ToolSet[string]): void {
	for (const key of Object.keys(definition))
		if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unsupported client tool field: ${key}`)
	if (isInvalidDescription(definition.description))
		throw new Error(
			`Client tool requires a static description of at most ${TOOL_DESCRIPTION_CHARACTERS} characters: ${name}`,
		)
	if (definition.inputExamples !== undefined && !Array.isArray(definition.inputExamples))
		throw new Error(`Client tool requires static input examples: ${name}`)
}

function validateDefinition(name: string, definition: ToolSet[string]): void {
	if (!TOOL_NAME_PATTERN.test(name)) throw new Error(`Invalid client tool name: ${name}`)
	if (definition.type !== undefined && definition.type !== "function")
		throw new Error(`Unsupported client tool type: ${name}`)
	if (typeof definition.execute !== "function") throw new Error(`Client tool requires execute: ${name}`)
	validateSchemas(name, definition)
	validateFields(name, definition)
}

export function captureClientTools(definitions: ToolSet = {}): ClientToolRegistry {
	const registry = new Map(Object.entries(definitions).map(([name, definition]) => [name, { ...definition }]))
	if (registry.size > CLIENT_TOOL_LIMIT) throw new Error("Register at most 8 client tools")
	for (const [name, definition] of registry) validateDefinition(name, definition)
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
			// JSON drops an absent payload, so a no-argument call arrives without one.
			const input = request.input ?? {}
			jsonValue(input)
			const validated = await validateValue(asSchema(definition.inputSchema), input)
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
