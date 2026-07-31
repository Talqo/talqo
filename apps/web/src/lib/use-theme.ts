import { useCallback, useSyncExternalStore } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "talqo-theme"

// Read the theme to use on first paint: stored preference wins, otherwise the
// OS preference. Called both by main.tsx before render (avoids a flash of the
// wrong theme) and as the store seed below, so it must be SSR-safe.
export function getInitialTheme(): Theme {
	if (typeof window === "undefined") {
		return "light"
	}
	const stored = window.localStorage.getItem(STORAGE_KEY)
	if (stored === "light" || stored === "dark") {
		return stored
	}
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function applyTheme(theme: Theme) {
	document.documentElement.classList.toggle("dark", theme === "dark")
	window.localStorage.setItem(STORAGE_KEY, theme)
}

// Module-level store (same pattern as lib/use-language.ts) so that every
// toggle instance stays in sync; localStorage only seeds the initial value.
let current: Theme = getInitialTheme()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

export function useTheme() {
	const theme = useSyncExternalStore(subscribe, () => current)

	const toggleTheme = useCallback(() => {
		current = current === "dark" ? "light" : "dark"
		applyTheme(current)
		for (const listener of listeners) {
			listener()
		}
	}, [])

	return { theme, toggleTheme }
}
