import { describe, expect, it } from "bun:test"

import { normalizeUsage, type ProviderUsage } from "./usage-normalization.ts"

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

	it("keeps a reported zero count instead of estimating", () => {
		expect(
			normalizeUsage({ inputText: "12345678", outputText: "12345678", usage: { inputTokens: 0, outputTokens: 0 } }),
		).toEqual({ inputTokens: 0, outputTokens: 0 })
	})

	it.each([
		["a negative", -1],
		["a fractional", 1.5],
		["a non-finite", Number.POSITIVE_INFINITY],
		["an unsafe", 2 ** 53],
		["a non-numeric", "12"],
	])("ignores %s reported count", (_label, value) => {
		const usage = { inputTokens: value, outputTokens: value } as unknown as ProviderUsage

		expect(normalizeUsage({ inputText: "", outputText: "", usage })).toEqual({ inputTokens: 0, outputTokens: 0 })
	})

	it("requires every cache component before summing reported details", () => {
		expect(
			normalizeUsage({ inputText: "", outputText: "", usage: { inputTokenDetails: { noCacheTokens: 8 } } }),
		).toEqual({
			inputTokens: 0,
			outputTokens: 0,
		})
		expect(normalizeUsage({ inputText: "", outputText: "", usage: { outputTokenDetails: { textTokens: 5 } } })).toEqual(
			{ inputTokens: 0, outputTokens: 0 },
		)
	})

	it("derives missing input tokens from an unambiguous total", () => {
		expect(normalizeUsage({ inputText: "", outputText: "", usage: { outputTokens: 4, totalTokens: 10 } })).toEqual({
			inputTokens: 6,
			outputTokens: 4,
		})
		expect(
			normalizeUsage({ inputText: "12345678", outputText: "", usage: { outputTokens: 10, totalTokens: 10 } }),
		).toEqual({ inputTokens: 0, outputTokens: 10 })
		expect(normalizeUsage({ inputText: "", outputText: "", usage: { outputTokens: 12, totalTokens: 10 } })).toEqual({
			inputTokens: 0,
			outputTokens: 12,
		})
	})

	it("derives missing output tokens only when the total covers them", () => {
		expect(
			normalizeUsage({ inputText: "", outputText: "12345678", usage: { inputTokens: 5, totalTokens: 5 } }),
		).toEqual({
			inputTokens: 5,
			outputTokens: 0,
		})
		expect(
			normalizeUsage({ inputText: "", outputText: "x".repeat(8), usage: { inputTokens: 12, totalTokens: 10 } }),
		).toEqual({ inputTokens: 12, outputTokens: 2 })
	})
})
