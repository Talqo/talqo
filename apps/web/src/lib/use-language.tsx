import { changeLanguage } from "i18next"
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react"

import { type DashboardLanguage, isDashboardLanguage } from "./languages"

const STORAGE_KEY = "talqo-language"

export function getStoredLanguage(): DashboardLanguage {
	if (typeof window === "undefined") {
		return "en"
	}
	const stored = window.localStorage.getItem(STORAGE_KEY)
	return isDashboardLanguage(stored) ? stored : "en"
}

const LanguageContext = createContext<{
	language: DashboardLanguage
	setLanguage: (language: DashboardLanguage) => void
} | null>(null)

export function LanguageProvider({ children }: { children: ReactNode }) {
	const [language, setLanguageState] = useState<DashboardLanguage>(getStoredLanguage)

	const setLanguage = useCallback((next: DashboardLanguage) => {
		setLanguageState(next)
		window.localStorage.setItem(STORAGE_KEY, next)
		changeLanguage(next)
	}, [])

	const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage])
	return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
	const context = useContext(LanguageContext)
	if (!context) {
		throw new Error("useLanguage must be used within LanguageProvider")
	}
	return context
}
