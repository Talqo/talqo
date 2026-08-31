// Postgres error codes (https://www.postgresql.org/docs/current/errcodes-appendix.html)
const UNIQUE_VIOLATION = "23505"
const FOREIGN_KEY_VIOLATION = "23503"
const RESTRICT_VIOLATION = "23001"
const MAX_CAUSE_DEPTH = 5

function hasPgErrorCode(error: unknown, code: string): boolean {
	// drizzle-orm wraps the raw Postgres error in a DrizzleQueryError's `.cause`.
	let current: unknown = error
	for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth += 1) {
		if (typeof current === "object" && "code" in current && current.code === code) return true
		current = current instanceof Error ? current.cause : undefined
	}
	return false
}

export function isUniqueViolation(error: unknown): boolean {
	return hasPgErrorCode(error, UNIQUE_VIOLATION)
}

export function isForeignKeyViolation(error: unknown): boolean {
	return hasPgErrorCode(error, FOREIGN_KEY_VIOLATION)
}

/** ON DELETE RESTRICT blocking a delete, distinct from the 23503 a missing parent raises. */
export function isRestrictViolation(error: unknown): boolean {
	return hasPgErrorCode(error, RESTRICT_VIOLATION)
}
