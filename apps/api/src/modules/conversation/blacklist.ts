type FilterResult = { blocked: boolean; text: string }
const NORMALIZATION_LOOK_BEHIND_CODE_UNITS = 8

export function createBlacklistFilter(words: readonly string[]) {
	const terms = words.filter(Boolean).map((word) => word.normalize("NFC").toLocaleLowerCase("und"))
	const lookBehind = Math.max(0, ...terms.map((term) => term.length)) + NORMALIZATION_LOOK_BEHIND_CODE_UNITS
	let pending = ""
	let blocked = false

	return {
		push(chunk: string): FilterResult {
			if (blocked) return { blocked: true, text: "" }
			pending += chunk
			const normalized = pending.normalize("NFC").toLocaleLowerCase("und")
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
