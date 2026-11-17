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

export function estimateTokens(text: string): number {
	return Math.ceil(Array.from(text).length / APPROXIMATION_CHARACTERS_PER_TOKEN)
}

function sumIfComplete(values: unknown[]): number | undefined {
	const counts = values.map(count)
	if (!counts.every((value): value is number => value !== undefined)) return undefined
	return counts.reduce((total, value) => total + value, 0)
}

function inputComponents(details: NonNullable<ProviderUsage["inputTokenDetails"]> = {}): number | undefined {
	return sumIfComplete([details.noCacheTokens, details.cacheReadTokens, details.cacheWriteTokens])
}

function outputComponents(details: NonNullable<ProviderUsage["outputTokenDetails"]> = {}): number | undefined {
	return sumIfComplete([details.textTokens, details.reasoningTokens])
}

function resolveTokens(
	reported: number | undefined,
	components: number | undefined,
	total: number | undefined,
	counterpart: number | undefined,
): number | undefined {
	const known = reported ?? components
	if (known !== undefined) return known
	if (total !== undefined && counterpart !== undefined && total >= counterpart) return total - counterpart
	return undefined
}

export function normalizeUsage(input: { inputText: string; outputText: string; usage?: ProviderUsage }): {
	inputTokens: number
	outputTokens: number
} {
	const usage = input.usage ?? {}
	const total = count(usage.totalTokens)
	const reportedInput = count(usage.inputTokens)
	const reportedOutput = count(usage.outputTokens)
	const componentInput = inputComponents(usage.inputTokenDetails)
	const componentOutput = outputComponents(usage.outputTokenDetails)
	return {
		inputTokens:
			resolveTokens(reportedInput, componentInput, total, reportedOutput ?? componentOutput) ??
			estimateTokens(input.inputText),
		outputTokens:
			resolveTokens(reportedOutput, componentOutput, total, reportedInput ?? componentInput) ??
			estimateTokens(input.outputText),
	}
}
