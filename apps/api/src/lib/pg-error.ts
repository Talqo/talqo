export function isUniqueViolation(error: unknown): boolean {
	// drizzle-orm wraps the raw Postgres error (with its `code`) in a DrizzleQueryError's
	// `.cause`, so the unique-violation code isn't on the caught error directly.
	let current: unknown = error
	for (let depth = 0; depth < 5 && current; depth += 1) {
		if (typeof current === "object" && "code" in current && current.code === "23505") return true
		current = current instanceof Error ? current.cause : undefined
	}
	return false
}
