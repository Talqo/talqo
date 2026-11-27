const MAX_SLUGS = 32
const MAX_SLUG_CHARACTERS = 256

export function isValidSlugPath(slugs: unknown): slugs is Array<string> {
	return (
		Array.isArray(slugs) &&
		slugs.length <= MAX_SLUGS &&
		slugs.every((slug) => typeof slug === "string" && slug.length > 0 && slug.length <= MAX_SLUG_CHARACTERS)
	)
}

export function splitSlugPath(splat: string | undefined): Array<string> {
	return (splat ?? "").split("/").filter((segment) => segment.length > 0)
}
