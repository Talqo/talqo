import { describe, expect, it } from "bun:test"

import { normalizeUsage } from "./usage-normalization.ts"

describe("usage normalization", () => {
	it("prefers valid provider input and output counts", () => {
		expect(
			normalizeUsage({ inputText: "ignored", outputText: "ignored", usage: { inputTokens: 11, outputTokens: 7 } }),
		).toEqual({
			inputTokens: 11,
			outputTokens: 7,
		})
	})

	it("derives an unambiguous missing side from total tokens", () => {
		expect(normalizeUsage({ inputText: "x", outputText: "x", usage: { inputTokens: 6, totalTokens: 10 } })).toEqual({
			inputTokens: 6,
			outputTokens: 4,
		})
	})

	it("does not add cached input or reasoning to provider totals that already include them", () => {
		expect(
			normalizeUsage({
				inputText: "x",
				outputText: "x",
				usage: { inputTokens: 8, cachedInputTokens: 3, outputTokens: 5, reasoningTokens: 2 },
			}),
		).toEqual({ inputTokens: 8, outputTokens: 5 })
	})

	it("derives missing totals from unambiguous cache and reasoning components", () => {
		expect(
			normalizeUsage({
				inputText: "ignored",
				outputText: "ignored",
				usage: {
					inputTokenDetails: { noCacheTokens: 8, cacheReadTokens: 3, cacheWriteTokens: 2 },
					outputTokenDetails: { textTokens: 5, reasoningTokens: 2 },
				},
			}),
		).toEqual({ inputTokens: 13, outputTokens: 7 })
	})

	it("falls back to ceiling Unicode code points divided by four", () => {
		expect(normalizeUsage({ inputText: "😀abcde", outputText: "😀abc" })).toEqual({ inputTokens: 2, outputTokens: 1 })
	})

	it("does not add breakdowns when provider totals already include them", () => {
		expect(
			normalizeUsage({
				inputText: "x",
				outputText: "x",
				usage: {
					inputTokens: 11,
					outputTokens: 7,
					totalTokens: 18,
					cachedInputTokens: 3,
					reasoningTokens: 2,
				},
			}),
		).toEqual({ inputTokens: 11, outputTokens: 7 })
	})
})
