import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { applyTheme, getInitialTheme, ThemeProvider } = await import("./use-theme")
const { ThemeToggle } = await import("@/components/preferences-controls")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const originalMatchMedia = window.matchMedia
let host: HTMLDivElement | undefined
let root: Root | undefined

function useSystemTheme(theme: "light" | "dark") {
	window.matchMedia = (query: string) => ({
		matches: theme === "dark" && query === "(prefers-color-scheme: dark)",
		media: query,
		onchange: null,
		addListener: () => {},
		removeListener: () => {},
		addEventListener: () => {},
		removeEventListener: () => {},
		dispatchEvent: () => false,
	})
}

function themeButton(label: string): HTMLButtonElement {
	const button = host?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
	if (!button) throw new Error(`Missing theme button: ${label}`)
	return button
}

async function renderThemeToggle() {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	await act(async () =>
		root?.render(
			<ThemeProvider>
				<ThemeToggle />
			</ThemeProvider>,
		),
	)
}

beforeEach(() => {
	window.localStorage.removeItem("talqo-theme")
	document.documentElement.classList.remove("dark")
})

afterEach(async () => {
	await act(async () => root?.unmount())
	host?.remove()
	host = undefined
	root = undefined
	window.localStorage.removeItem("talqo-theme")
	document.documentElement.classList.remove("dark")
	window.matchMedia = originalMatchMedia
})

test("resolves the initial theme from valid storage or the system preference", () => {
	const cases = [
		{ stored: "light", system: "dark", expected: "light" },
		{ stored: "dark", system: "light", expected: "dark" },
		{ stored: "invalid", system: "dark", expected: "dark" },
	] as const

	for (const { stored, system, expected } of cases) {
		useSystemTheme(system)
		window.localStorage.setItem("talqo-theme", stored)
		expect(getInitialTheme()).toBe(expected)
	}
})

test("applies and persists the initial theme and each toggle", async () => {
	useSystemTheme("light")
	applyTheme(getInitialTheme())
	await renderThemeToggle()

	expect(themeButton(t("header.toDarkTheme"))).toBeDefined()
	expect(document.documentElement.classList.contains("dark")).toBe(false)
	expect(window.localStorage.getItem("talqo-theme")).toBe("light")

	await act(async () => themeButton(t("header.toDarkTheme")).click())
	expect(themeButton(t("header.toLightTheme"))).toBeDefined()
	expect(document.documentElement.classList.contains("dark")).toBe(true)
	expect(window.localStorage.getItem("talqo-theme")).toBe("dark")

	await act(async () => themeButton(t("header.toLightTheme")).click())
	expect(themeButton(t("header.toDarkTheme"))).toBeDefined()
	expect(document.documentElement.classList.contains("dark")).toBe(false)
	expect(window.localStorage.getItem("talqo-theme")).toBe("light")
})
