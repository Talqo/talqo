import { describe, expect, it } from "bun:test"

import { InvalidAgentInputError, normalizeAgentInput } from "./agent.service.ts"

describe("normalizeAgentInput", () => {
	it("trims the name and system prompt", () => {
		const input = normalizeAgentInput({ name: "  Support  ", systemPrompt: " Help users. ", wordBlacklist: [] })

		expect(input).toEqual({ name: "Support", systemPrompt: "Help users.", wordBlacklist: [] })
	})

	it("rejects an empty name", () => {
		expect(() => normalizeAgentInput({ name: "   ", systemPrompt: "Prompt", wordBlacklist: [] })).toThrow(
			InvalidAgentInputError,
		)
	})

	it("rejects a name longer than 100 characters", () => {
		expect(() => normalizeAgentInput({ name: "x".repeat(101), systemPrompt: "Prompt", wordBlacklist: [] })).toThrow(
			InvalidAgentInputError,
		)
	})

	it("rejects an empty system prompt", () => {
		expect(() => normalizeAgentInput({ name: "Agent", systemPrompt: "  ", wordBlacklist: [] })).toThrow(
			InvalidAgentInputError,
		)
	})

	it("rejects a system prompt longer than 20000 characters", () => {
		expect(() => normalizeAgentInput({ name: "Agent", systemPrompt: "x".repeat(20_001), wordBlacklist: [] })).toThrow(
			InvalidAgentInputError,
		)
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

	it("rejects a blacklist word longer than 100 characters", () => {
		expect(() => normalizeAgentInput({ name: "A", systemPrompt: "P", wordBlacklist: ["x".repeat(101)] })).toThrow(
			InvalidAgentInputError,
		)
	})

	it("rejects more than 100 blacklist words", () => {
		const words = Array.from({ length: 101 }, (_, index) => `word${index}`)

		expect(() => normalizeAgentInput({ name: "A", systemPrompt: "P", wordBlacklist: words })).toThrow(
			InvalidAgentInputError,
		)
	})

	it("counts limit violations after deduplication, so 101 duplicates of one word pass as one word", () => {
		const words = Array.from({ length: 101 }, () => "spam")

		expect(normalizeAgentInput({ name: "A", systemPrompt: "P", wordBlacklist: words }).wordBlacklist).toEqual(["spam"])
	})
})
