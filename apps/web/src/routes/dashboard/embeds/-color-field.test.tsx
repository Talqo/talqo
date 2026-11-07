import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ColorField } = await import("./-color-field")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const LABEL = "Primary"

let host: HTMLDivElement
let root: Root

async function renderField(value: string, against = "#ffffff") {
	await act(async () => {
		root.render(
			<ColorField against={against} id="primary" label={LABEL} onChange={() => {}} readOnly={false} value={value} />,
		)
	})
}

function hexInput(): HTMLInputElement {
	const label = t("embedSetup.hexValue", { label: LABEL })
	const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
	if (!input) throw new Error("Missing hex color input")
	return input
}

function describedElement(input: HTMLInputElement): HTMLElement | null {
	const id = input.getAttribute("aria-describedby")
	return id ? host.querySelector<HTMLElement>(`#${id}`) : null
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

describe("ColorField", () => {
	test("accepts a high-contrast color without warnings", async () => {
		await renderField("#000000")

		expect(hexInput().getAttribute("aria-invalid")).toBe("false")
		expect(hexInput().hasAttribute("aria-describedby")).toBe(false)
		expect(host.querySelector("[role='alert']") === null).toBe(true)
		expect(host.textContent).not.toContain(t("embedSetup.contrastWarning"))
	})

	test("announces low contrast for a valid color", async () => {
		await renderField("#777777")

		const warning = describedElement(hexInput())
		expect(warning?.textContent).toBe(t("embedSetup.contrastWarning"))
		expect(hexInput().getAttribute("aria-invalid")).toBe("false")
		expect(host.querySelector("[role='alert']") === null).toBe(true)
	})

	test("does not calculate a contrast ratio against a malformed comparison color", async () => {
		await renderField("#000000", "not-a-color")

		expect(hexInput().getAttribute("aria-invalid")).toBe("false")
		expect(hexInput().hasAttribute("aria-describedby")).toBe(false)
		expect(host.textContent).not.toContain(t("embedSetup.contrastWarning"))
		expect(host.querySelector("[role='alert']") === null).toBe(true)
	})

	test("associates malformed hex input with its validation error", async () => {
		await renderField("#12")

		const error = describedElement(hexInput())
		expect(hexInput().getAttribute("aria-invalid")).toBe("true")
		expect(error?.getAttribute("role")).toBe("alert")
		expect(error?.textContent).toBe(t("embedSetup.colorInvalid"))
		expect(host.textContent).not.toContain(t("embedSetup.contrastWarning"))
	})
})
