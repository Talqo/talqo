import { describe, expect, test } from "bun:test"

import { agentFormSchema } from "./agent-schema.ts"

describe("agentFormSchema", () => {
	test("rejects whitespace-only name and system prompt", () => {
		const cases = [
			{ field: "name", input: { name: " \t\n ", systemPrompt: "Answer customer questions." } },
			{ field: "systemPrompt", input: { name: "Support agent", systemPrompt: " \t\n " } },
		] as const

		for (const { field, input } of cases) {
			const result = agentFormSchema.safeParse(input)
			expect(result.success).toBe(false)
			if (!result.success) {
				expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true)
			}
		}
	})
})
