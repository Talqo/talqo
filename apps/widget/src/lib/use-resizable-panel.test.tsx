import type { WidgetPosition } from "@talqo/shared/widget-appearance"
import type { PointerEvent as ReactPointerEvent, RefObject } from "react"
import type { Root } from "react-dom/client"

import { afterEach, describe, expect, mock, test } from "bun:test"

await import("@/test-setup")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { useResizablePanel } = await import("./use-resizable-panel")
const { createRoot } = await import("react-dom/client")
const { act, useEffect } = await import("react")

const RESIZE_QUERY = "(min-width: 640px) and (pointer: fine)"
const RECT = { left: 500, right: 820, top: 116, bottom: 500, width: 320, height: 384 } as DOMRect
const SIZE_KEY = "widget-test:size"

type MediaListener = (event: { matches: boolean }) => void
let mediaListeners: Array<{ query: string; type: string; listener: MediaListener }> = []
const originalMatchMedia = window.matchMedia

function stubMatchMedia(matches: boolean) {
	mediaListeners = []
	window.matchMedia = mock((query: string) => ({
		matches: query === RESIZE_QUERY ? matches : false,
		media: query,
		addEventListener(type: string, listener: MediaListener) {
			mediaListeners.push({ query, type, listener })
		},
		removeEventListener(type: string, listener: MediaListener) {
			mediaListeners = mediaListeners.filter(
				(entry) => !(entry.query === query && entry.type === type && entry.listener === listener),
			)
		},
		addListener: () => {},
		removeListener: () => {},
		onchange: null,
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia
}

type PanelApi = ReturnType<typeof useResizablePanel>
const apiHolder = { current: undefined as PanelApi | undefined }
let panel: HTMLDivElement
let panelRef: RefObject<HTMLElement | null>
let host: HTMLDivElement
let root: Root | undefined

function Probe({ position, sizeKey }: { position?: WidgetPosition; sizeKey?: string }) {
	const value = useResizablePanel(position, panelRef, sizeKey)
	useEffect(() => {
		apiHolder.current = value
	})
	return null
}

function api(): PanelApi {
	if (!apiHolder.current) throw new Error("panel hook not rendered")
	return apiHolder.current
}

async function unmount() {
	if (root) await act(async () => root?.unmount())
	host?.remove()
	panel?.remove()
	root = undefined
}

async function render(position?: WidgetPosition, sizeKey?: string) {
	await unmount()
	panel = document.createElement("div")
	panel.getBoundingClientRect = () => RECT
	document.body.append(panel)
	panelRef = { current: panel }
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	await act(async () => root?.render(<Probe position={position} sizeKey={sizeKey} />))
}

async function changeMedia(matches: boolean) {
	const active = mediaListeners.filter((entry) => entry.query === RESIZE_QUERY && entry.type === "change")
	expect(active).toHaveLength(1)
	await act(async () => {
		for (const { listener } of active) listener({ matches })
	})
}

function pointerEvent(
	type: string,
	init: { pointerId?: number; pointerType?: string; clientX?: number; clientY?: number },
) {
	return Object.assign(new MouseEvent(type, { bubbles: true }), init)
}

async function startResize(event = pointerEvent("pointerdown", { pointerId: 7, pointerType: "mouse" })) {
	await act(async () => api().startResize(event as unknown as ReactPointerEvent<HTMLElement>))
}

async function moveTo(clientX: number, clientY: number, pointerId = 7) {
	await act(async () => window.dispatchEvent(pointerEvent("pointermove", { clientX, clientY, pointerId })))
}

async function endDrag(type: "pointerup" | "pointercancel", pointerId = 7) {
	await act(async () => window.dispatchEvent(pointerEvent(type, { pointerId })))
}

afterEach(async () => {
	await unmount()
	window.matchMedia = originalMatchMedia
	sessionStorage.removeItem(SIZE_KEY)
})

describe("useResizablePanel", () => {
	test("applies a custom size only while the fine-pointer media query matches", async () => {
		stubMatchMedia(true)
		await render()

		expect(api().resizable).toBe(true)
		await act(async () => api().resizeBy(30, 40))
		expect(api().size).toEqual({ width: 350, height: 424 })

		await changeMedia(true)
		expect(api().resizable).toBe(true)
		expect(api().size).toEqual({ width: 350, height: 424 })

		await changeMedia(false)
		expect(api().resizable).toBe(false)
		expect(api().size).toBeNull()
	})

	test("restores a finished drag on the next page and clears it when reset", async () => {
		stubMatchMedia(true)
		await render("bottom-right", SIZE_KEY)
		await startResize()
		await moveTo(400, 60)
		await endDrag("pointerup")
		expect(api().size).toEqual({ width: 420, height: 440 })

		stubMatchMedia(false)
		await render("bottom-right", SIZE_KEY)
		expect(api().size).toBeNull()
		await changeMedia(true)
		expect(api().size).toEqual({ width: 420, height: 440 })

		await act(async () => api().toggleExpanded())
		stubMatchMedia(true)
		await render("bottom-right", SIZE_KEY)
		expect(api().size).toBeNull()
	})

	test("fits the saved size to a smaller viewport without forgetting it", async () => {
		stubMatchMedia(true)
		await render("bottom-right", SIZE_KEY)
		await act(async () => api().toggleExpanded())
		const originalHeight = window.innerHeight
		try {
			Object.defineProperty(window, "innerHeight", { configurable: true, value: 480 })
			await render("bottom-right", SIZE_KEY)
			expect(api().size).toEqual({ width: 448, height: 388 })
		} finally {
			Object.defineProperty(window, "innerHeight", { configurable: true, value: originalHeight })
		}
		await render("bottom-right", SIZE_KEY)
		expect(api().size).toEqual({ width: 448, height: 560 })
	})

	test("unsubscribes from the media query on unmount", async () => {
		stubMatchMedia(true)
		await render()
		expect(mediaListeners).toHaveLength(1)

		await act(async () => root?.unmount())
		root = undefined

		expect(mediaListeners).toHaveLength(0)
	})

	test("resizes from the measured panel and ignores a missing panel", async () => {
		stubMatchMedia(true)
		await render()

		const measured = panelRef.current
		panelRef.current = null
		await act(async () => api().resizeBy(10, 10))
		expect(api().size).toBeNull()

		panelRef.current = measured
		await act(async () => api().resizeBy(30, 40))
		expect(api().size).toEqual({ width: 350, height: 424 })

		await act(async () => api().resizeBy(10, 10))
		expect(api().size).toEqual({ width: 360, height: 434 })
	})

	test("ignores touch pointers and a detached panel", async () => {
		stubMatchMedia(true)
		await render()

		await startResize(pointerEvent("pointerdown", { pointerId: 1, pointerType: "touch" }))
		await moveTo(400, 100, 1)
		expect(api().size).toBeNull()

		panelRef.current = null
		await startResize(pointerEvent("pointerdown", { pointerId: 2, pointerType: "mouse" }))
		expect(api().size).toBeNull()
	})

	test("grows upward and away from the left edge for a bottom-left widget", async () => {
		stubMatchMedia(true)
		await render("bottom-left")

		await startResize()
		await moveTo(900, 100)

		expect(api().size).toEqual({ width: 400, height: 400 })
		await endDrag("pointerup")
	})

	test("resizes only for the pointer that started the drag and ends on up or cancel", async () => {
		stubMatchMedia(true)
		await render()

		await startResize()
		await moveTo(400, 100, 8)
		expect(api().size).toBeNull()

		await moveTo(500, 100)
		expect(api().size).toEqual({ width: 320, height: 400 })

		await endDrag("pointerup", 8)
		await moveTo(400, 100)
		expect(api().size).toEqual({ width: 420, height: 400 })

		await endDrag("pointerup")
		await moveTo(300, 100)
		expect(api().size).toEqual({ width: 420, height: 400 })

		await startResize(pointerEvent("pointerdown", { pointerId: 9, pointerType: "mouse" }))
		await moveTo(500, 100, 9)
		expect(api().size).toEqual({ width: 320, height: 400 })

		await endDrag("pointercancel", 9)
		await moveTo(400, 100, 9)
		expect(api().size).toEqual({ width: 320, height: 400 })
	})
})
