export type FontVariant = "inter" | "nunito"

const STORAGE_KEY = "talqo-font-variant"

// A/B typography experiment: each browser gets one family (uniformly at
// random) and keeps it. :root[data-font] in globals.css does the switch.
export function resolveFontVariant(stored: string | null, random: () => number): FontVariant {
	if (stored === "inter" || stored === "nunito") {
		return stored
	}
	return random() < 0.5 ? "inter" : "nunito"
}

// Called before render from main.tsx so the variant applies without a flash.
export function applyInitialFont(): void {
	const variant = resolveFontVariant(window.localStorage.getItem(STORAGE_KEY), Math.random)
	document.documentElement.dataset.font = variant
	window.localStorage.setItem(STORAGE_KEY, variant)
}
