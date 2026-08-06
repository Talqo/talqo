import { useCallback, useSyncExternalStore } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "talqo-theme"

// First-paint theme: stored preference, else OS preference. Called pre-render
// (avoids a theme flash), so it must be SSR-safe.
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
