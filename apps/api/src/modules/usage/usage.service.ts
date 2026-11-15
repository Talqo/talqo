import type { UsageRecord } from "./usage.repository.ts"

import * as repository from "./usage.repository.ts"
export { estimateTokens, normalizeUsage } from "./usage-normalization.ts"
export type { ProviderUsage } from "./usage-normalization.ts"
export { getDailyUsageTotalsByAgent } from "./usage.repository.ts"

export type { UsageRecord } from "./usage.repository.ts"

export async function recordUsage(value: UsageRecord): Promise<void> {
	return repository.recordUsage(value)
}
