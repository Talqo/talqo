import type { Root } from "react-dom/client"

import { PREVIEW_CHANNEL_VERSION, readyMessage } from "@talqo/shared/preview-channel"
import { afterEach, expect, spyOn, test } from "bun:test"

await import("./test-setup")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { PreviewWidget } = await import("./preview")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

let root: Root | undefined
let host: HTMLElement | undefined

afterEach(async () => {
	if (root) await act(async () => root?.unmount())
	host?.remove()
	window.history.replaceState({}, "", "/")
	root = undefined
	host = undefined
})

test("announces readiness and applies config only from the trusted dashboard origin", async () => {
	window.history.replaceState(
		{},
		"",
		"/?title=Initial&forcedScheme=dark&parentOrigin=https%3A%2F%2Fdashboard.example.com",
	)
	using postMessage = spyOn(window.parent, "postMessage").mockImplementation(() => {})
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)

	await act(async () => root?.render(<PreviewWidget />))

	expect(postMessage).toHaveBeenCalledWith(readyMessage(), "https://dashboard.example.com")
	expect(host.querySelector(".talqo-widget") === null).toBe(true)

	const data = {
		source: "talqo-preview",
		version: PREVIEW_CHANNEL_VERSION,
		type: "config",
		appearance: { light: { primary: "#123456" } },
		title: "Updated",
		forcedScheme: "light",
		isAvailable: true,
	}
	await act(async () => {
		window.dispatchEvent(new MessageEvent("message", { origin: "https://other.example.com", data }))
	})
	expect(host.querySelector(".talqo-widget") === null).toBe(true)

	await act(async () => {
		window.dispatchEvent(new MessageEvent("message", { origin: "https://dashboard.example.com", data }))
	})
	expect(host.querySelector("h2")?.textContent).toBe("Updated")
	expect(host.querySelector(".talqo-widget")?.getAttribute("data-scheme")).toBe("light")
	expect(host.querySelector<HTMLElement>(".talqo-widget")?.style.getPropertyValue("--talqo-primary-input")).toBe(
		"#123456",
	)
})
