// The statistics filter rides in the ?agents= search param (ADR-0018): accepts one id or a JSON
// id list and normalizes to a deduped list; only a missing param means "all agents".
export function parseAgentsParam(value: unknown): string[] | undefined {
	if (value === undefined) return undefined
	const list = Array.isArray(value) ? value : [value]
	return [...new Set(list.filter((id): id is string => typeof id === "string" && id.length > 0))]
}
