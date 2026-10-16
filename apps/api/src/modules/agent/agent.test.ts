import { describe, expect, it } from "bun:test"

import { composeSystemPrompt, InvalidAgentInputError, normalizeAgentInput } from "./agent.service.ts"

describe("composeSystemPrompt", () => {
	it("prepends a non-empty platform prompt to the saved agent prompt", () => {
		expect(composeSystemPrompt("Configured agent instructions.")).toMatch(/\S\nConfigured agent instructions\.$/)
	})
})

describe("normalizeAgentInput", () => {
	it("trims the name and system prompt", () => {
		const input = normalizeAgentInput({ name: "  Support  ", systemPrompt: " Help users. ", wordBlacklist: [] })

		expect(input).toEqual({ name: "Support", systemPrompt: "Help users.", wordBlacklist: [] })
	})

	it.each([
		["an empty name", { name: "   ", systemPrompt: "Prompt", wordBlacklist: [] as string[] }],
		[
			"a name longer than 100 characters",
			{ name: "x".repeat(101), systemPrompt: "Prompt", wordBlacklist: [] as string[] },
		],
		["an empty system prompt", { name: "Agent", systemPrompt: "  ", wordBlacklist: [] as string[] }],
		[
			"a system prompt longer than 20000 characters",
			{ name: "Agent", systemPrompt: "x".repeat(20_001), wordBlacklist: [] as string[] },
		],
		["a blacklist word longer than 100 characters", { name: "A", systemPrompt: "P", wordBlacklist: ["x".repeat(101)] }],
		[
			"more than 100 blacklist words",
			{ name: "A", systemPrompt: "P", wordBlacklist: Array.from({ length: 101 }, (_, index) => `word${index}`) },
		],
	])("rejects %s", (_label, input) => {
		expect(() => normalizeAgentInput(input)).toThrow(InvalidAgentInputError)
	})

	it("trims each blacklist word", () => {
		const input = normalizeAgentInput({ name: "A", systemPrompt: "P", wordBlacklist: ["  spam ", "abuse "] })

		expect(input.wordBlacklist).toEqual(["spam", "abuse"])
	})

	it("drops empty blacklist entries after trimming", () => {
		const input = normalizeAgentInput({ name: "A", systemPrompt: "P", wordBlacklist: ["spam", "   ", ""] })

		expect(input.wordBlacklist).toEqual(["spam"])
	})

	it("deduplicates blacklist words case-insensitively, keeping the first spelling", () => {
		const input = normalizeAgentInput({
			name: "A",
			systemPrompt: "P",
			wordBlacklist: ["Spam", "SPAM", "abuse", "spam"],
		})

		expect(input.wordBlacklist).toEqual(["Spam", "abuse"])
	})

	it("counts limit violations after deduplication, so 101 duplicates of one word pass as one word", () => {
		const words = Array.from({ length: 101 }, () => "spam")

		expect(normalizeAgentInput({ name: "A", systemPrompt: "P", wordBlacklist: words }).wordBlacklist).toEqual(["spam"])
	})
})
