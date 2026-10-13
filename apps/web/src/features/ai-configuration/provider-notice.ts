import type { AiProviderConfiguration } from "./types.ts"

export type ProviderNotice = "missing" | "checkFailed"

export function providerNotice(query: {
	isError: boolean
	data: { data: Pick<AiProviderConfiguration, "health"> } | undefined
}): ProviderNotice | undefined {
	if (query.isError) return "checkFailed"
	const health = query.data?.data.health
	if (health === undefined || health === "configured") return undefined
	return "missing"
}
