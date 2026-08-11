import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react"

export type Theme = "light" | "dark"

const STORAGE_KEY = "talqo-theme"

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

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void } | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setTheme] = useState<Theme>(getInitialTheme)

	const toggleTheme = useCallback(() => {
		setTheme((previous) => {
			const next = previous === "dark" ? "light" : "dark"
			applyTheme(next)
			return next
		})
	}, [])

	const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme])
	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
	const context = useContext(ThemeContext)
	if (!context) {
		throw new Error("useTheme must be used within ThemeProvider")
	}
	return context
}
