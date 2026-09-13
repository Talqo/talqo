import * as repository from "./usage.repository.ts"
export { normalizeUsage } from "./usage-normalization.ts"
export type { ProviderUsage } from "./usage-normalization.ts"
export { UsageConflictError } from "./usage.repository.ts"

export type UsageRecord = repository.UsageRecord

export async function recordUsage(value: UsageRecord): Promise<void> {
	return repository.recordUsage(value)
}
