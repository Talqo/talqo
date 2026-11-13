import type { ReactNode } from "react"
import type { Root } from "react-dom/client"

import { act, createTestHarness } from "@/testing/component-harness"
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"

const { useLanguage } = await import("./use-language")
const { useTheme } = await import("./use-theme")
const { Component } = await import("react")

let host: HTMLDivElement
let root: Root
let harness: ReturnType<typeof createTestHarness>

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
	harness = createTestHarness()
	;({ host, root } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

test("useTheme explains the missing provider", async () => {
	await renderWithoutProvider(MissingThemeProvider)

	expect(host.textContent).toContain("useTheme must be used within ThemeProvider")
})

test("useLanguage explains the missing provider", async () => {
	await renderWithoutProvider(MissingLanguageProvider)

	expect(host.textContent).toContain("useLanguage must be used within LanguageProvider")
})
