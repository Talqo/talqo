const FIRST_SUFFIX_NUMBER = 2

// The create shortcuts need a free name before the operator customizes it.
export function nextDefaultName(existingNames: string[], baseName: string): string {
	const taken = new Set(existingNames.map((name) => name.toLowerCase()))
	if (!taken.has(baseName.toLowerCase())) return baseName
	for (let suffix = FIRST_SUFFIX_NUMBER; ; suffix += 1) {
		const candidate = `${baseName} ${suffix}`
		if (!taken.has(candidate.toLowerCase())) return candidate
	}
}
