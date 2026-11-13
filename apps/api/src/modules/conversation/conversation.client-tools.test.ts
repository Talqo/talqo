import type { ToolExecutionOptions } from "ai"

import { describe, expect, test } from "bun:test"

import { type ClientToolRequest, createClientToolChannel } from "./conversation.client-tools.ts"

function executeTool(channel: ReturnType<typeof createClientToolChannel>) {
	const definition = Object.values(channel.binding.tools)[0]
	if (!definition?.execute) throw new Error("Expected a tool proxy")
	return definition.execute as (input: unknown, options: ToolExecutionOptions<unknown>) => Promise<unknown>
}

describe("browser tool channel", () => {
	test("correlates parallel calls, accepts identical duplicate results, and counts failures toward the call budget", async () => {
		const requests: ClientToolRequest[] = []
		const channel = createClientToolChannel(
			[{ name: "lookup", inputSchema: { type: "object" } }],
			(request) => requests.push(request),
			400_000,
		)
		const execute = executeTool(channel)
		const calls = Array.from({ length: 16 }, (_, index) =>
			execute({}, { toolCallId: `call-${index}`, messages: [], context: undefined }),
		)
		const results = Promise.allSettled(calls)
		expect(requests).toHaveLength(16)
		for (let index = 15; index >= 0; index--) {
			const result =
				index % 2
					? { toolCallId: `call-${index}`, error: "Failed" }
					: { toolCallId: `call-${index}`, output: { index } }
			channel.accept(result)
			channel.accept(result)
		}
		expect((await results).filter((result) => result.status === "fulfilled")).toHaveLength(8)
		await expect(execute({}, { toolCallId: "excess", messages: [], context: undefined })).rejects.toThrow("limit")
		expect(requests).toHaveLength(16)
		expect(() => channel.accept({ toolCallId: "call-0", output: "changed" })).toThrow("Conflicting")
		expect(() => channel.accept({ toolCallId: "unknown", output: null })).toThrow("Unknown")
	})

	test("interrupts pending execution without replay and refuses oversized input", async () => {
		let dispatched = 0
		const channel = createClientToolChannel(
			[{ name: "read", inputSchema: {} }],
			() => {
				dispatched++
			},
			400_000,
		)
		const execute = executeTool(channel)
		await expect(
			execute("x".repeat(262_144), { toolCallId: "large", messages: [], context: undefined }),
		).rejects.toThrow("too large")
		const pending = execute({}, { toolCallId: "pending", messages: [], context: undefined }).catch(
			(error: unknown) => error,
		)
		channel.interrupt()
		expect(await pending).toMatchObject({ message: "Client connection interrupted" })
		expect(dispatched).toBe(1)
		expect(() => channel.accept({ toolCallId: "pending", output: null })).toThrow("Unknown")
		await expect(execute({}, { toolCallId: "late", messages: [], context: undefined })).rejects.toThrow("interrupted")
		expect(dispatched).toBe(1)
	})
})
