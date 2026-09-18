type FilterResult = { blocked: boolean; text: string }

function normalizeForMatch(value: string): string {
	return value.normalize("NFD").toLocaleLowerCase("und").normalize("NFD")
}

export function createBlacklistFilter(words: readonly string[]) {
	const terms = words.filter(Boolean).map(normalizeForMatch)
	if (terms.length === 0) {
		return {
			push: (chunk: string): FilterResult => ({ blocked: false, text: chunk }),
			finish: (): string => "",
		}
	}
	// Retain enough raw text that a literal match split across provider chunks cannot be emitted early.
	const lookBehind = Math.max(0, ...terms.map((term) => term.length))
	let pending = ""
	let blocked = false

	return {
		push(chunk: string): FilterResult {
			if (blocked) return { blocked: true, text: "" }
			pending += chunk
			const normalized = normalizeForMatch(pending)
			if (terms.some((term) => normalized.includes(term))) {
				blocked = true
				pending = ""
				return { blocked: true, text: "" }
			}
			if (pending.length <= lookBehind) return { blocked: false, text: "" }
			const split = pending.length - lookBehind
			const text = pending.slice(0, split)
			pending = pending.slice(split)
			return { blocked: false, text }
		},
		finish(): string {
			if (blocked) return ""
			const text = pending
			pending = ""
			return text
		},
	}
}
