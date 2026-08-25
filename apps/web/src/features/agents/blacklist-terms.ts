export const BLACKLIST_TERM_LIMIT = 100

export type AddTermResult =
	| { ok: true; term: string; terms: string[] }
	| { ok: false; reason: "duplicate" | "empty" | "limit" }

export function addBlacklistTerm(terms: string[], input: string): AddTermResult {
	const term = input.trim()
	if (term.length === 0) return { ok: false, reason: "empty" }
	if (terms.some((existing) => existing.toLowerCase() === term.toLowerCase())) {
		return { ok: false, reason: "duplicate" }
	}
	if (terms.length >= BLACKLIST_TERM_LIMIT) return { ok: false, reason: "limit" }
	return { ok: true, term, terms: [...terms, term] }
}

export function removeBlacklistTerm(terms: string[], term: string): string[] {
	const target = term.toLowerCase()
	return terms.filter((existing) => existing.toLowerCase() !== target)
}
