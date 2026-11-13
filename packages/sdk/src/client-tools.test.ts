import { tool } from "ai"
import { describe, expect, test } from "bun:test"
import { z } from "zod"

import { captureClientTools, jsonValue } from "./client-tools.ts"

describe("client tool registration and execution", () => {
	test("accepts AI SDK tools and validates the original input and output schemas", async () => {
		let received: unknown
		const registry = captureClientTools({
			lookup: tool({
				description: "Read an item",
				inputSchema: z.object({ id: z.string().trim().min(1) }),
				outputSchema: z.object({ count: z.number().int() }),
				execute: (input, options) => {
					received = { input, options }
					return { count: 3 }
				},
			}),
		})
		expect(await registry.manifest()).toMatchObject([
			{ name: "lookup", description: "Read an item", inputSchema: { type: "object" } },
		])
		const signal = new AbortController().signal
		const request = {
			version: 1 as const,
			type: "tool-call" as const,
			toolCallId: "call-1",
			toolName: "lookup",
			input: { id: " item " },
			messages: [{ role: "user" as const, content: "Find it" }],
		}
		expect(await registry.execute(request, signal)).toEqual({ count: 3 })
		expect(received).toEqual({
			input: { id: "item" },
			options: { toolCallId: "call-1", messages: request.messages, abortSignal: signal, context: undefined },
		})
		await expect(registry.execute({ ...request, input: { id: " " } }, signal)).rejects.toThrow("Invalid tool value")
		await expect(registry.execute({ ...request, toolName: "other" }, signal)).rejects.toThrow("Unknown client tool")
	})

	test("rejects unsupported behavior and a ninth tool before dispatch", () => {
		const definition = tool({ inputSchema: z.object({}), execute: () => null })
		expect(
			captureClientTools(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`tool${index}`, definition])))
				.size,
		).toBe(8)
		expect(() =>
			captureClientTools(Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`tool${index}`, definition]))),
		).toThrow("at most 8")
		expect(() => captureClientTools({ unsafe: tool({ ...definition, needsApproval: true }) })).toThrow(
			"Unsupported client tool field",
		)
	})

	test("rejects values JSON would silently change and oversized payloads", () => {
		for (const value of [
			undefined,
			NaN,
			Infinity,
			1n,
			{ nested: undefined },
			new Date(),
			[undefined],
			Array.from({ length: 1 }),
			{ toJSON: () => "changed" },
		])
			expect(() => jsonValue(value)).toThrow()
		const cycle: { self?: unknown } = {}
		cycle.self = cycle
		expect(() => jsonValue(cycle)).toThrow()
		expect(() => jsonValue("x".repeat(256 * 1024))).toThrow("256 KiB")
		expect(jsonValue({ nested: [null, false, 42, "text"] })).toBe('{"nested":[null,false,42,"text"]}')
	})
})
