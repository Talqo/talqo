import type { ReactNode } from "react"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { useLanguage } = await import("./use-language")
const { useTheme } = await import("./use-theme")
const { createRoot } = await import("react-dom/client")
const { act, Component } = await import("react")

let host: HTMLDivElement
let root: Root

function MissingThemeProvider() {
	useTheme()
	return null
}

function MissingLanguageProvider() {
	useLanguage()
	return null
}

class ErrorBoundary extends Component<{ children: ReactNode }, { message?: string }> {
	state: { message?: string } = {}

	static getDerivedStateFromError(error: Error) {
		return { message: error.message }
	}

	render() {
		return this.state.message ? <p>{this.state.message}</p> : this.props.children
	}
}

async function renderWithoutProvider(Probe: () => null) {
	await act(async () => root.render(<ErrorBoundary>{<Probe />}</ErrorBoundary>))
}

beforeEach(() => {
	spyOn(console, "error").mockImplementation(() => {})
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	mock.restore()
})

test("useTheme explains the missing provider", async () => {
	await renderWithoutProvider(MissingThemeProvider)

	expect(host.textContent).toContain("useTheme must be used within ThemeProvider")
})

test("useLanguage explains the missing provider", async () => {
	await renderWithoutProvider(MissingLanguageProvider)

	expect(host.textContent).toContain("useLanguage must be used within LanguageProvider")
})
