import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ModelAutocomplete } = await import("./model-autocomplete")
const { createRoot } = await import("react-dom/client")
const { act, useState } = await import("react")

const EMPTY_LABEL = "No matching models"
const TRIGGER_LABEL = "Show models"

let host: HTMLDivElement
let root: Root
let changes: string[]

function ControlledAutocomplete({ models }: { models: string[] | null }) {
	const [value, setValue] = useState("")
	return (
		<>
			<ModelAutocomplete
				id="model"
				value={value}
				onChange={(next) => {
					changes.push(next)
					setValue(next)
				}}
				models={models}
				emptyLabel={EMPTY_LABEL}
				triggerLabel={TRIGGER_LABEL}
			/>
			<button type="button">Outside</button>
		</>
	)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function modelInput(): HTMLInputElement {
	const input = document.getElementById("model")
	if (!(input instanceof HTMLInputElement)) throw new Error("model input not rendered")
	return input
}

function suggestionTrigger(): HTMLButtonElement | null {
	return document.querySelector<HTMLButtonElement>(`button[aria-label="${TRIGGER_LABEL}"]`)
}

function outsideButton(): HTMLButtonElement {
	const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
		(candidate) => candidate.textContent === "Outside",
	)
	if (!button) throw new Error("outside button not rendered")
	return button
}

function optionNames(): (string | null)[] {
	return [...document.querySelectorAll('[role="option"]')].map((option) => option.textContent)
}

async function renderAutocomplete(models: string[] | null) {
	await act(async () => root.render(<ControlledAutocomplete models={models} />))
	await settle()
}

async function openSuggestions() {
	if (modelInput().getAttribute("aria-expanded") !== "true") {
		const trigger = suggestionTrigger()
		if (!trigger) throw new Error("model suggestions trigger not rendered")
		await act(async () => trigger.click())
		await settle()
	}
	expect(modelInput().getAttribute("aria-expanded")).toBe("true")
}

async function type(text: string) {
	await act(async () => {
		modelInput().focus()
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(modelInput(), text)
		modelInput().dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }))
	})
	await settle()
}

async function pressKey(key: string) {
	await act(async () => {
		modelInput().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
	})
	await settle()
}

function expectSuggestionsClosed() {
	expect(modelInput().getAttribute("aria-expanded")).toBe("false")
	expect(document.querySelector('[role="listbox"]') === null).toBe(true)
}

beforeEach(() => {
	changes = []
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

describe("ModelAutocomplete", () => {
	test("filters the provided models and shows the empty label when nothing matches", async () => {
		await renderAutocomplete(["gpt-4o", "text-embedding-3-large"])

		await type("gpt")
		expect(optionNames()).toEqual(["gpt-4o"])
		expect(modelInput().value).toBe("gpt")
		expect(changes).toEqual(["gpt"])

		await type("missing")
		expect(optionNames()).toEqual([])
		expect(document.body.textContent).toContain(EMPTY_LABEL)
	})

	test("moves the active option with the keyboard and selects it with Enter", async () => {
		await renderAutocomplete(["alpha", "beta", "gamma"])
		await openSuggestions()

		await pressKey("ArrowDown")
		let activeId = modelInput().getAttribute("aria-activedescendant")
		expect(activeId ? document.getElementById(activeId)?.textContent : null).toBe("alpha")

		await pressKey("ArrowDown")
		activeId = modelInput().getAttribute("aria-activedescendant")
		expect(activeId ? document.getElementById(activeId)?.textContent : null).toBe("beta")
		expect(modelInput().value).toBe("")

		await pressKey("Enter")
		expect(modelInput().value).toBe("beta")
		expect(changes).toEqual(["beta"])
		expectSuggestionsClosed()
	})

	test("keeps a custom model and dismisses suggestions on outside press or blur", async () => {
		await renderAutocomplete(["gpt-4o"])
		await type("provider/private-model")
		await openSuggestions()

		await act(async () => {
			outsideButton().dispatchEvent(new Event("pointerdown", { bubbles: true }))
			outsideButton().click()
		})
		await settle()

		expectSuggestionsClosed()
		expect(modelInput().value).toBe("provider/private-model")
		expect(changes).toEqual(["provider/private-model"])

		await openSuggestions()
		await act(async () => {
			modelInput().focus()
			outsideButton().focus()
		})
		await settle()

		expectSuggestionsClosed()
		expect(modelInput().value).toBe("provider/private-model")
		expect(changes).toEqual(["provider/private-model"])
	})

	test("accepts a custom model without suggestion controls when models are unavailable", async () => {
		await renderAutocomplete(null)

		expect(suggestionTrigger() === null).toBe(true)
		await type("provider/private-model")

		expect(modelInput().value).toBe("provider/private-model")
		expect(changes).toEqual(["provider/private-model"])
		expect(document.body.textContent).not.toContain(EMPTY_LABEL)
		expect(document.querySelector('[role="listbox"]') === null).toBe(true)
	})
})
