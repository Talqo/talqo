import { estimateTokens } from "./usage-normalization.ts"
import * as repository from "./usage.repository.ts"
export { estimateTokens, normalizeUsage } from "./usage-normalization.ts"
export type { ProviderUsage } from "./usage-normalization.ts"
export { getDailyUsageTotalsByAgent } from "./usage.repository.ts"

export type UsageRecord = repository.UsageRecord

export async function recordUsage(value: UsageRecord): Promise<void> {
	return repository.recordUsage(value)
}

export async function recordRecoveredUsage(input: {
	agentId: string
	assistantText: string
	conversationId: string
	estimatedInputTokens: number
	generationAttemptId: string
	inputTokens: number | null
	model: string
	outcome: string
	outputTokens: number | null
	provider: string
}): Promise<{ inputTokens: number; outputTokens: number }> {
	const usage = {
		inputTokens: input.inputTokens ?? input.estimatedInputTokens,
		outputTokens: input.outputTokens ?? estimateTokens(input.assistantText),
	}
	await recordUsage({
		agentId: input.agentId,
		conversationId: input.conversationId,
		generationAttemptId: input.generationAttemptId,
		provider: input.provider,
		model: input.model,
		outcome: input.outcome,
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
	})
	return usage
}
