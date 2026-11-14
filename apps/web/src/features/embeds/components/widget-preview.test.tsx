import type { WidgetAppearance } from "@talqo/shared/widget-appearance"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { readyMessage } from "@talqo/shared/preview-channel"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "https://dashboard.example.com/" })
const PREVIEW_ORIGIN = window.location.origin
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { buildPreviewDocument, WidgetPreview } = await import("./widget-preview")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

const appearance: WidgetAppearance = {
	light: {
		primary: "#112233",
		textOnPrimary: "#ffffff",
		background: "#f8f8f8",
		surface: "#eeeeee",
		text: "#111111",
	},
	dark: {
		primary: "#aabbcc",
		textOnPrimary: "#001122",
		background: "#111111",
		surface: "#222222",
		text: "#fafafa",
	},
	position: "bottom-right",
	theme: "system",
	themeToggle: true,
	language: "en",
}

const defaultProps: Parameters<typeof WidgetPreview>[0] = {
	appearance,
	title: "Initial title",
	activeScheme: "light",
	previewKey: "embed",
}
const CDN_WIDGET_URL = "https://cdn.example.com/widget.js"

let host: HTMLDivElement | undefined
let root: Root | undefined

async function renderPreview(
	overrides: Partial<Parameters<typeof WidgetPreview>[0]> = {},
	Preview: typeof WidgetPreview = WidgetPreview,
) {
	await act(async () => root?.render(<Preview {...defaultProps} {...overrides} />))
}

async function renderCdnPreview(overrides: Partial<Parameters<typeof WidgetPreview>[0]> = {}) {
	const previousPreviewUrl = import.meta.env.VITE_WIDGET_PREVIEW_URL
	const previousWidgetUrl = import.meta.env.VITE_WIDGET_CDN_URL
	try {
		Reflect.deleteProperty(import.meta.env, "VITE_WIDGET_PREVIEW_URL")
		Reflect.set(import.meta.env, "VITE_WIDGET_CDN_URL", CDN_WIDGET_URL)
		await renderPreview(overrides)
	} finally {
		if (previousPreviewUrl === undefined) Reflect.deleteProperty(import.meta.env, "VITE_WIDGET_PREVIEW_URL")
		else Reflect.set(import.meta.env, "VITE_WIDGET_PREVIEW_URL", previousPreviewUrl)
		if (previousWidgetUrl === undefined) Reflect.deleteProperty(import.meta.env, "VITE_WIDGET_CDN_URL")
		else Reflect.set(import.meta.env, "VITE_WIDGET_CDN_URL", previousWidgetUrl)
	}
}

function frameElement(): HTMLIFrameElement {
	const frame = host?.querySelector("iframe")
	if (!(frame instanceof HTMLIFrameElement)) throw new Error("Missing preview frame")
	return frame
}

function mockChildWindow(frame: HTMLIFrameElement) {
	Object.defineProperty(frame, "contentWindow", { configurable: true, value: window })
	return spyOn(window, "postMessage").mockImplementation(() => {})
}

function dispatchMessage(init: MessageEventInit) {
	window.dispatchEvent(new MessageEvent("message", init))
}

beforeEach(() => {
	host = document.createElement("div")
	root = createRoot(host)
})

afterEach(async () => {
	if (root) await act(async () => root?.unmount())
	root = undefined
	host = undefined
	mock.restore()
})

describe("buildPreviewDocument", () => {
	test("boots the deployed widget bundle in preview mode", () => {
		const document = buildPreviewDocument(
			"https://cdn.example.com/widget.js?v=42&channel=stable",
			"https://dashboard.example.com",
		)

		expect(document).toContain('src="https://cdn.example.com/widget.js?v=42&amp;channel=stable"')
		expect(document).toContain("data-talqo-preview")
		expect(document).toContain('data-talqo-parent-origin="https://dashboard.example.com"')
		expect(document).not.toContain("preview.html")
	})

	test("escapes attribute-breaking characters in the script URL and parent origin", () => {
		const document = buildPreviewDocument(
			'https://cdn.example.com/widget.js?a=1&b="x"<y>',
			'https://dashboard.example.com/?a=1&b="x"<y>',
		)

		expect(document).toContain('src="https://cdn.example.com/widget.js?a=1&amp;b=&quot;x&quot;&lt;y&gt;"')
		expect(document).toContain(
			'data-talqo-parent-origin="https://dashboard.example.com/?a=1&amp;b=&quot;x&quot;&lt;y&gt;"',
		)
		expect(document).not.toContain("<y>")
	})
})

describe("WidgetPreview", () => {
	test("ignores ready messages from the wrong source or origin and malformed messages", async () => {
		await renderPreview()
		const postMessage = mockChildWindow(frameElement())

		dispatchMessage({ source: null, origin: PREVIEW_ORIGIN, data: readyMessage() })
		dispatchMessage({ source: window, origin: "https://other.example.com", data: readyMessage() })
		dispatchMessage({
			source: window,
			origin: PREVIEW_ORIGIN,
			data: { ...readyMessage(), version: 0 },
		})

		expect(postMessage).not.toHaveBeenCalled()
	})

	test("responds to ready with the latest config and the preview origin", async () => {
		await renderPreview()
		const postMessage = mockChildWindow(frameElement())
		const updatedAppearance = { ...appearance, position: "bottom-left" as const }
		await renderPreview({ appearance: updatedAppearance, title: "Updated title", activeScheme: "dark" })
		postMessage.mockClear()

		dispatchMessage({ source: window, origin: PREVIEW_ORIGIN, data: readyMessage() })

		expect(postMessage).toHaveBeenCalledTimes(1)
		expect(postMessage).toHaveBeenCalledWith(
			{
				source: "talqo-preview",
				version: 1,
				type: "config",
				appearance: updatedAppearance,
				title: "Updated title",
				forcedScheme: "dark",
				isAvailable: true,
			},
			PREVIEW_ORIGIN,
		)
	})

	test("posts appearance updates without replacing or reloading the frame", async () => {
		await renderPreview()
		const frame = frameElement()
		const initialSrc = frame.getAttribute("src")
		const postMessage = mockChildWindow(frame)
		const updatedAppearance = { ...appearance, position: "bottom-left" as const }

		await renderPreview({ appearance: updatedAppearance })

		expect(postMessage).toHaveBeenCalledWith(
			{
				source: "talqo-preview",
				version: 1,
				type: "config",
				appearance: updatedAppearance,
				title: "Initial title",
				forcedScheme: "light",
				isAvailable: true,
			},
			PREVIEW_ORIGIN,
		)
		expect(frameElement()).toBe(frame)
		expect(frame.getAttribute("src")).toBe(initialSrc)
		expect(initialSrc).toContain("position=bottom-right")
	})

	test("carries the whole first-paint appearance in the frame URL", async () => {
		await renderPreview()
		const url = new URL(frameElement().src)

		expect(url.origin).toBe(PREVIEW_ORIGIN)
		expect(url.pathname).toBe("/preview.html")
		expect(url.searchParams.get("lightPrimary")).toBe(appearance.light.primary)
		expect(url.searchParams.get("lightTextOnPrimary")).toBe(appearance.light.textOnPrimary)
		expect(url.searchParams.get("lightBackground")).toBe(appearance.light.background)
		expect(url.searchParams.get("lightSurface")).toBe(appearance.light.surface)
		expect(url.searchParams.get("lightText")).toBe(appearance.light.text)
		expect(url.searchParams.get("darkPrimary")).toBe(appearance.dark.primary)
		expect(url.searchParams.get("darkTextOnPrimary")).toBe(appearance.dark.textOnPrimary)
		expect(url.searchParams.get("darkBackground")).toBe(appearance.dark.background)
		expect(url.searchParams.get("darkSurface")).toBe(appearance.dark.surface)
		expect(url.searchParams.get("darkText")).toBe(appearance.dark.text)
		expect(url.searchParams.get("position")).toBe(appearance.position)
		expect(url.searchParams.get("theme")).toBe(appearance.theme)
		expect(url.searchParams.get("themeToggle")).toBe(String(appearance.themeToggle))
		expect(url.searchParams.get("language")).toBe(appearance.language)
		expect(url.searchParams.get("forcedScheme")).toBe("light")
		expect(url.searchParams.get("title")).toBe("Initial title")
		expect(url.searchParams.get("parentOrigin")).toBe(PREVIEW_ORIGIN)
	})

	test("omits the forced scheme and title when the preview lets the embed decide", async () => {
		await renderPreview({ title: undefined, activeScheme: undefined })
		const url = new URL(frameElement().src)

		expect(url.searchParams.has("forcedScheme")).toBe(false)
		expect(url.searchParams.has("title")).toBe(false)
	})

	test("disconnects its resize observer on unmount", async () => {
		let resize: (() => void) | undefined
		const disconnect = mock()
		const NativeResizeObserver = globalThis.ResizeObserver
		class TestResizeObserver implements ResizeObserver {
			constructor(private readonly callback: ResizeObserverCallback) {}
			observe() {
				resize = () =>
					this.callback([{ contentRect: new DOMRectReadOnly(0, 0, 168, 420) } as ResizeObserverEntry], this)
			}
			disconnect = disconnect
			unobserve() {}
		}
		Object.defineProperty(globalThis, "ResizeObserver", {
			configurable: true,
			writable: true,
			value: TestResizeObserver,
		})
		try {
			await renderPreview()
			if (!resize) throw new Error("preview did not observe its container")
			await act(async () => resize?.())

			await act(async () => root?.unmount())
			root = undefined
			expect(disconnect).toHaveBeenCalledTimes(1)
		} finally {
			Object.defineProperty(globalThis, "ResizeObserver", {
				configurable: true,
				writable: true,
				value: NativeResizeObserver,
			})
		}
	})

	test("removes its message listener on unmount", async () => {
		const addEventListener = spyOn(window, "addEventListener")
		const removeEventListener = spyOn(window, "removeEventListener")
		await renderPreview()
		const messageListener = addEventListener.mock.calls.find(([type]) => type === "message")?.[1]

		await act(async () => root?.unmount())
		root = undefined

		expect(messageListener).toBeDefined()
		expect(removeEventListener).toHaveBeenCalledWith("message", messageListener)
	})
})

describe("WidgetPreview with only a CDN widget URL", () => {
	test("boots a sandboxed srcDoc and accepts ready only from its frame at the null origin", async () => {
		await renderCdnPreview()
		const frame = frameElement()
		const sourceDocument = frame.getAttribute("srcdoc")

		expect(frame.hasAttribute("src")).toBe(false)
		expect(sourceDocument).toContain(`src="${CDN_WIDGET_URL}"`)
		expect(sourceDocument).toContain("data-talqo-preview")
		expect(sourceDocument).toContain(`data-talqo-parent-origin="${PREVIEW_ORIGIN}"`)
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts")

		const postMessage = mockChildWindow(frame)
		dispatchMessage({ source: null, origin: "null", data: readyMessage() })
		dispatchMessage({ source: window, origin: "https://other.example.com", data: readyMessage() })
		expect(postMessage).not.toHaveBeenCalled()

		dispatchMessage({ source: window, origin: "null", data: readyMessage() })

		expect(postMessage).toHaveBeenCalledTimes(1)
		expect(postMessage).toHaveBeenCalledWith(
			{
				source: "talqo-preview",
				version: 1,
				type: "config",
				appearance,
				title: "Initial title",
				forcedScheme: "light",
				isAvailable: true,
			},
			"*",
		)
	})

	test("posts appearance edits without remounting the inline frame", async () => {
		await renderCdnPreview()
		const frame = frameElement()
		const initialDocument = frame.getAttribute("srcdoc")
		const postMessage = mockChildWindow(frame)
		const updatedAppearance = {
			...appearance,
			light: { ...appearance.light, primary: "#445566" },
		}

		await renderCdnPreview({ appearance: updatedAppearance })

		expect(postMessage).toHaveBeenCalledWith(
			{
				source: "talqo-preview",
				version: 1,
				type: "config",
				appearance: updatedAppearance,
				title: "Initial title",
				forcedScheme: "light",
				isAvailable: true,
			},
			"*",
		)
		expect(frameElement()).toBe(frame)
		expect(frame.getAttribute("srcdoc")).toBe(initialDocument)
	})
})
