import * as repository from "./usage.repository.ts"
export { estimateTokens, normalizeUsage } from "./usage-normalization.ts"
export type { ProviderUsage } from "./usage-normalization.ts"

export type UsageRecord = repository.UsageRecord
export type { DailyUsageTotals } from "./usage.repository.ts"

export async function recordUsage(value: UsageRecord): Promise<void> {
	return repository.recordUsage(value)
}

export async function getDailyUsageTotals(since: Date, agentId?: string): Promise<repository.DailyUsageTotals[]> {
	return repository.getDailyUsageTotals(since, agentId)
}

export async function getUsageTotalsByAgent(
	since: Date,
): Promise<{ agentId: string; inputTokens: number; outputTokens: number }[]> {
	return repository.getUsageTotalsByAgent(since)
}
