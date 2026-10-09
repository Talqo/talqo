// The statistics filter rides in the ?agents= search param so a filtered view is shareable:
// accepts one id or a JSON id list and normalizes to a deduped list; only a missing param
// means "all agents".
export function parseAgentsParam(value: unknown): string[] | undefined {
	if (value === undefined) return undefined
	if (typeof value === "string" && value.startsWith("[")) {
		try {
			value = JSON.parse(value)
		} catch {
			// Not JSON; treat the raw string as one id.
		}
	}
	const list = Array.isArray(value) ? value : [value]
	return [...new Set(list.filter((id): id is string => typeof id === "string" && id.length > 0))]
}
