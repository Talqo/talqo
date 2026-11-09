import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { BlacklistTermsEditor } = await import("./blacklist-terms-editor")
const { BLACKLIST_TERM_LIMIT, BLACKLIST_TERM_MAX_LENGTH } = await import("@/features/agents/blacklist-terms")
const { createRoot } = await import("react-dom/client")
const { act, useState } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let emitted: string[][]
let submits: number

function Editor({ initialTerms, disabled = false }: { initialTerms: string[]; disabled?: boolean }) {
	const [terms, setTerms] = useState(initialTerms)
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault()
				submits += 1
			}}
		>
			<BlacklistTermsEditor
				id="blacklist"
				value={terms}
				disabled={disabled}
				onChange={(next) => {
					emitted.push(next)
					setTerms(next)
				}}
			/>
		</form>
	)
}

async function renderEditor(terms: string[], disabled = false) {
	emitted = []
	submits = 0
	await act(async () => root.render(<Editor key={terms.join("|")} initialTerms={terms} disabled={disabled} />))
}

function input(): HTMLInputElement {
	const found = host.querySelector<HTMLInputElement>("#blacklist")
	if (!found) throw new Error("term input not rendered")
	return found
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find(
		(candidate) => candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
	)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

async function click(target: HTMLElement) {
	await act(async () => target.click())
}

async function type(target: HTMLInputElement, value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(target, value)
		target.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function pressEnter(target: HTMLInputElement) {
	await act(async () => {
		target.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
	})
}

function liveRegion(): string {
	return host.querySelector<HTMLElement>('[aria-live="polite"]')?.textContent ?? ""
}

beforeEach(() => {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

describe("BlacklistTermsEditor", () => {
	test("adds a trimmed term on Enter without submitting the surrounding form", async () => {
		await renderEditor(["spam"])
		expect(input().getAttribute("aria-describedby")).toBe("blacklist-help")

		await type(input(), "  abuse  ")
		await pressEnter(input())

		expect(emitted).toEqual([["spam", "abuse"]])
		expect(input().value).toBe("")
		expect(submits).toBe(0)
		expect(liveRegion()).toBe(t("blacklist.added", { word: "abuse" }))
	})

	test("rejects a duplicate case-insensitively, keeps the draft, and clears the error on edit", async () => {
		await renderEditor(["Spam"])

		await type(input(), "  SPAM  ")
		await click(button(t("blacklist.addTerm")))

		const alert = host.querySelector<HTMLElement>('[role="alert"]')
		expect(alert?.textContent).toBe(t("blacklist.duplicateError", { word: "SPAM" }))
		expect(input().getAttribute("aria-invalid")).toBe("true")
		expect(input().value).toBe("  SPAM  ")
		expect(emitted).toEqual([])

		await type(input(), "S")
		expect(host.querySelector('[role="alert"]') === null).toBe(true)
		expect(input().getAttribute("aria-invalid") === null).toBe(true)
	})

	test("clears a rejection when a later term is added or removed", async () => {
		await renderEditor(["Spam"])

		await type(input(), "SPAM")
		await click(button(t("blacklist.addTerm")))
		expect(liveRegion()).toBe("")
		await type(input(), "abuse")
		await click(button(t("blacklist.addTerm")))
		expect(host.querySelector('[role="alert"]') === null).toBe(true)
		expect(liveRegion()).toBe(t("blacklist.added", { word: "abuse" }))

		await type(input(), "SPAM")
		await click(button(t("blacklist.addTerm")))
		expect(host.querySelector('[role="alert"]') !== null).toBe(true)
		await click(button(t("blacklist.removeTerm", { word: "Spam" })))
		expect(host.querySelector('[role="alert"]') === null).toBe(true)
	})

	test("reports an empty term without changing the list", async () => {
		await renderEditor(["spam"])

		await click(button(t("blacklist.addTerm")))

		expect(host.querySelector<HTMLElement>('[role="alert"]')?.textContent).toBe(t("blacklist.emptyError"))
		expect(emitted).toEqual([])
	})

	test("reports the limit and overlong terms before adding them", async () => {
		const full = Array.from({ length: BLACKLIST_TERM_LIMIT }, (_, index) => `word${index}`)
		await renderEditor(full)
		await type(input(), "overflow")
		await click(button(t("blacklist.addTerm")))
		expect(host.querySelector<HTMLElement>('[role="alert"]')?.textContent).toBe(
			t("blacklist.limitError", { limit: BLACKLIST_TERM_LIMIT }),
		)
		expect(emitted).toEqual([])

		await renderEditor([])
		await type(input(), "x".repeat(BLACKLIST_TERM_MAX_LENGTH + 1))
		await click(button(t("blacklist.addTerm")))
		expect(host.querySelector<HTMLElement>('[role="alert"]')?.textContent).toBe(
			t("blacklist.tooLongError", { max: BLACKLIST_TERM_MAX_LENGTH }),
		)
		expect(emitted).toEqual([])
	})

	test("removes only the selected term and announces it", async () => {
		await renderEditor(["spam", "abuse"])

		await click(button(t("blacklist.removeTerm", { word: "spam" })))

		expect(emitted).toEqual([["abuse"]])
		expect(host.querySelector(`[aria-label="${t("blacklist.termsLabel")}"]`)?.textContent).toBe("abuse")
		expect(liveRegion()).toBe(t("blacklist.removed", { word: "spam" }))
	})

	test("shows terms read-only when the form is disabled", async () => {
		await renderEditor(["spam", "abuse"], true)

		expect(host.querySelector("#blacklist") === null).toBe(true)
		expect(host.textContent).toContain("spam")
		expect(host.textContent).toContain("abuse")
		expect(host.querySelector(`[aria-label="${t("blacklist.removeTerm", { word: "spam" })}"]`) === null).toBe(true)
	})

	test("shows the term count and only renders the list when terms exist", async () => {
		await renderEditor([])
		expect(host.textContent).toContain(t("blacklist.count", { used: 0, limit: BLACKLIST_TERM_LIMIT }))
		expect(host.querySelector(`[aria-label="${t("blacklist.termsLabel")}"]`) === null).toBe(true)

		await renderEditor(["spam"])
		expect(host.textContent).toContain(t("blacklist.count", { used: 1, limit: BLACKLIST_TERM_LIMIT }))
		expect(host.querySelector(`[aria-label="${t("blacklist.termsLabel")}"]`) !== null).toBe(true)
	})
})
