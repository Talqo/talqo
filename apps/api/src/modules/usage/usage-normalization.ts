export type ProviderUsage = {
	cachedInputTokens?: number
	inputTokens?: number
	inputTokenDetails?: {
		cacheReadTokens?: number
		cacheWriteTokens?: number
		noCacheTokens?: number
	}
	outputTokens?: number
	outputTokenDetails?: { reasoningTokens?: number; textTokens?: number }
	reasoningTokens?: number
	totalTokens?: number
}

const APPROXIMATION_CHARACTERS_PER_TOKEN = 4

function count(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function approximate(text: string): number {
	return Math.ceil([...text].length / APPROXIMATION_CHARACTERS_PER_TOKEN)
}

function sumIfComplete(values: unknown[]): number | undefined {
	const counts = values.map(count)
	return counts.every((value) => value !== undefined)
		? counts.reduce<number>((total, value) => total + (value ?? 0), 0)
		: undefined
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
		inputTokens: inputTokens ?? approximate(input.inputText),
		outputTokens: outputTokens ?? approximate(input.outputText),
	}
}
