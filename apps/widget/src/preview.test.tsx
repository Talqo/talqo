import type { Root } from "react-dom/client"

import { PREVIEW_CHANNEL_VERSION, readyMessage } from "@talqo/shared/preview-channel"
import { afterEach, expect, spyOn, test } from "bun:test"

await import("./test-setup")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { PreviewWidget } = await import("./preview")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

const CONFIG_MESSAGE = {
	source: "talqo-preview",
	version: PREVIEW_CHANNEL_VERSION,
	type: "config",
	appearance: {},
	isAvailable: true,
} as const

let root: Root | undefined
let host: HTMLElement | undefined

afterEach(async () => {
	if (root) await act(async () => root?.unmount())
	host?.remove()
	window.history.replaceState({}, "", "/")
	root = undefined
	host = undefined
})

async function renderPreview(element = <PreviewWidget />): Promise<HTMLElement> {
	const elementHost = document.createElement("div")
	document.body.append(elementHost)
	host = elementHost
	root = createRoot(elementHost)
	await act(async () => root?.render(element))
	return elementHost
}

async function dispatchMessage(origin: string, data: unknown) {
	await act(async () => {
		window.dispatchEvent(new MessageEvent("message", { origin, data }))
	})
}

test("announces readiness and applies config only from the trusted dashboard origin", async () => {
	window.history.replaceState(
		{},
		"",
		"/?title=Initial&forcedScheme=dark&parentOrigin=https%3A%2F%2Fdashboard.example.com",
	)
	using postMessage = spyOn(window.parent, "postMessage").mockImplementation(() => {})
	const view = await renderPreview()

	expect(postMessage).toHaveBeenCalledWith(readyMessage(), "https://dashboard.example.com")
	expect(view.querySelector(".talqo-widget")).toBeNull()

	const data = {
		source: "talqo-preview",
		version: PREVIEW_CHANNEL_VERSION,
		type: "config",
		appearance: { light: { primary: "#123456" } },
		title: "Updated",
		forcedScheme: "light",
		isAvailable: true,
	}
	await dispatchMessage("https://other.example.com", data)
	expect(view.querySelector(".talqo-widget")).toBeNull()

	await dispatchMessage("https://dashboard.example.com", data)
	expect(view.querySelector("h2")?.textContent).toBe("Updated")
	expect(view.querySelector(".talqo-widget")?.getAttribute("data-scheme")).toBe("light")
	expect(view.querySelector<HTMLElement>(".talqo-widget")?.style.getPropertyValue("--talqo-primary-input")).toBe(
		"#123456",
	)
})

test("stays silent and ignores config without a trusted parent origin", async () => {
	using postMessage = spyOn(window.parent, "postMessage").mockImplementation(() => {})
	const view = await renderPreview()

	expect(postMessage).not.toHaveBeenCalled()

	await dispatchMessage("https://dashboard.example.com", CONFIG_MESSAGE)
	expect(view.childElementCount).toBe(0)
})

test("ignores a malformed config from the trusted origin", async () => {
	window.history.replaceState({}, "", "/?parentOrigin=https%3A%2F%2Fdashboard.example.com")
	using postMessage = spyOn(window.parent, "postMessage").mockImplementation(() => {})
	const view = await renderPreview()

	await dispatchMessage("https://dashboard.example.com", { ...CONFIG_MESSAGE, title: "First" })
	expect(view.querySelector("h2")?.textContent).toBe("First")

	await dispatchMessage("https://dashboard.example.com", { ...CONFIG_MESSAGE, source: "other-embed", title: "Broken" })
	expect(view.querySelector("h2")?.textContent).toBe("First")
	expect(postMessage).toHaveBeenCalledWith(readyMessage(), "https://dashboard.example.com")
})

test("follows parentOrigin prop changes and stops accepting the previous origin", async () => {
	using postMessage = spyOn(window.parent, "postMessage").mockImplementation(() => {})
	const view = await renderPreview(<PreviewWidget parentOrigin="https://a.example.com" />)
	expect(postMessage).toHaveBeenLastCalledWith(readyMessage(), "https://a.example.com")

	await act(async () => root?.render(<PreviewWidget parentOrigin="https://b.example.com" />))
	expect(postMessage).toHaveBeenLastCalledWith(readyMessage(), "https://b.example.com")

	await dispatchMessage("https://a.example.com", { ...CONFIG_MESSAGE, title: "From A" })
	expect(view.querySelector("h2")).toBeNull()

	await dispatchMessage("https://b.example.com", { ...CONFIG_MESSAGE, title: "From B" })
	expect(view.querySelector("h2")?.textContent).toBe("From B")
})
