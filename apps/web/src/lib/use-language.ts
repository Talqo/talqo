import { useCallback, useSyncExternalStore } from "react"

import { type DashboardLanguage, isDashboardLanguage } from "./languages"

const STORAGE_KEY = "talqo-language"

export function getStoredLanguage(): DashboardLanguage {
	if (typeof window === "undefined") {
		return "en"
	}
	const stored = window.localStorage.getItem(STORAGE_KEY)
	return isDashboardLanguage(stored) ? stored : "en"
}

// Module-level store so every consumer stays in sync within the tab;
// localStorage only seeds the initial value.
let current: DashboardLanguage = getStoredLanguage()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

// i18n.ts hooks in here to keep the dashboard UI language in sync without a
// circular import (the dependency is one-way: i18n -> use-language).
export const subscribeLanguage = subscribe

export function useLanguage() {
	const language = useSyncExternalStore(subscribe, () => current)

	const setLanguage = useCallback((next: DashboardLanguage) => {
		current = next
		window.localStorage.setItem(STORAGE_KEY, next)
		for (const listener of listeners) {
			listener()
		}
	}, [])

	return { language, setLanguage }
}
