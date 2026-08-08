export function parseBlacklist(value: string): string[] {
	const words = value
		.split(",")
		.map((word) => word.trim())
		.filter(Boolean)
	return [...new Set(words)]
}
