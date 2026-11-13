import type { GetAiProviderConfiguration200 } from "@/api/generated/models/ai-providers/getAiProviderConfiguration200.zod.ts"

export type ProviderNotice = "missing" | "checkFailed"

export function providerNotice(query: {
	isError: boolean
	data: { data: Pick<GetAiProviderConfiguration200, "health"> } | undefined
}): ProviderNotice | undefined {
	if (query.isError) return "checkFailed"
	const health = query.data?.data.health
	if (health === undefined || health === "configured") return undefined
	return "missing"
}
