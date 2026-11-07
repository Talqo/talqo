import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { LanguageSelect } = await import("./preferences-controls")
const { LanguageProvider } = await import("@/lib/use-language")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { default: i18n } = await import("i18next")

let host: HTMLDivElement | undefined
let root: Root | undefined

function selectTrigger(): HTMLElement {
	const trigger = host?.querySelector<HTMLElement>("[role=combobox]")
	if (!trigger) throw new Error("Missing language selector")
	return trigger
}

async function renderLanguageSelect() {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	await act(async () =>
		root?.render(
			<LanguageProvider>
				<LanguageSelect />
			</LanguageProvider>,
		),
	)
}

async function unmountLanguageSelect() {
	await act(async () => root?.unmount())
	host?.remove()
	host = undefined
	root = undefined
}

async function click(target: HTMLElement) {
	await act(async () => target.click())
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

beforeEach(async () => {
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
	await i18n.changeLanguage("en")
})

afterEach(async () => {
	await unmountLanguageSelect()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
	await i18n.changeLanguage("en")
})

test.each([
	{ stored: "cs", language: "cs", label: "Čeština", displayed: "CS" },
	{ stored: "unsupported", language: "en", label: "English", displayed: "EN" },
] as const)(
	"initializes the selector and document from storage, rejecting unknown languages",
	async ({ stored, language, label, displayed }) => {
		window.localStorage.setItem("talqo-language", stored)
		await renderLanguageSelect()

		expect(document.documentElement.lang).toBe(language)
		expect(selectTrigger().textContent).toBe(displayed)
		expect(selectTrigger().getAttribute("aria-label")).toBe(`${i18n.t("header.language")}: ${label}`)
	},
)

test("selecting a language updates i18next, the document, storage, and the selector", async () => {
	await renderLanguageSelect()
	expect(document.documentElement.lang).toBe("en")
	expect(selectTrigger().textContent).toBe("EN")

	await click(selectTrigger())
	const czech = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
		(option) => option.textContent === "Čeština",
	)
	if (!czech) throw new Error("Missing Czech language option")
	await click(czech)

	expect(i18n.language).toBe("cs")
	expect(document.documentElement.lang).toBe("cs")
	expect(window.localStorage.getItem("talqo-language")).toBe("cs")
	expect(selectTrigger().textContent).toBe("CS")
	expect(selectTrigger().getAttribute("aria-label")).toBe(`${i18n.t("header.language")}: Čeština`)
})
