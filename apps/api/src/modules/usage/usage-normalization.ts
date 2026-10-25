import type { ProviderUsage } from "@/modules/ai-provider/ai-provider.service.ts"

export type { ProviderUsage }

const APPROXIMATION_CHARACTERS_PER_TOKEN = 4

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

export function estimateTokens(text: string): number {
	return Math.ceil(Array.from(text).length / APPROXIMATION_CHARACTERS_PER_TOKEN)
}

function sumIfComplete(values: unknown[]): number | undefined {
	const counts = values.map(count)
	if (!counts.every((value): value is number => value !== undefined)) return undefined
	return counts.reduce((total, value) => total + value, 0)
}

export function normalizeUsage(input: { inputText: string; outputText: string; usage?: ProviderUsage }): {
	inputTokens: number
	outputTokens: number
} {
	const usage = input.usage ?? {}
	const reportedInput = count(usage.inputTokens)
	const reportedOutput = count(usage.outputTokens)
	const total = count(usage.totalTokens)
	let inputTokens =
		reportedInput ??
		sumIfComplete([
			usage.inputTokenDetails?.noCacheTokens,
			usage.inputTokenDetails?.cacheReadTokens,
			usage.inputTokenDetails?.cacheWriteTokens,
		])
	let outputTokens =
		reportedOutput ?? sumIfComplete([usage.outputTokenDetails?.textTokens, usage.outputTokenDetails?.reasoningTokens])
	if (inputTokens === undefined && total !== undefined && outputTokens !== undefined && total >= outputTokens) {
		inputTokens = total - outputTokens
	}
	if (outputTokens === undefined && total !== undefined && inputTokens !== undefined && total >= inputTokens) {
		outputTokens = total - inputTokens
	}
	return {
		inputTokens: inputTokens ?? estimateTokens(input.inputText),
		outputTokens: outputTokens ?? estimateTokens(input.outputText),
	}
}
