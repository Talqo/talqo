const FIRST_SUFFIX_NUMBER = 2

// Agent names are unique case-insensitively (server enforces it), but the create
// shortcut always uses the localized default name. Suffix it so repeated creates pass.
export function nextDefaultAgentName(existingNames: string[], baseName: string): string {
	const taken = new Set(existingNames.map((name) => name.toLowerCase()))
	if (!taken.has(baseName.toLowerCase())) return baseName
	for (let suffix = FIRST_SUFFIX_NUMBER; ; suffix += 1) {
		const candidate = `${baseName} ${suffix}`
		if (!taken.has(candidate.toLowerCase())) return candidate
	}
}
