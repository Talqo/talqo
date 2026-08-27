import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

const { EmbeddedWidget } = await import("./test-setup").then(() => import("./embedded-widget"))

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
const originalMatchMedia = window.matchMedia

function stubMatchMedia(matches: boolean) {
	window.matchMedia = mock(
		(query: string) =>
			({
				matches: query.includes("(min-width: 640px) and (pointer: fine)") ? matches : false,
				media: query,
				addEventListener: () => {},
				removeEventListener: () => {},
				addListener: () => {},
				removeListener: () => {},
				onchange: null,
				dispatchEvent: () => false,
			}) as MediaQueryList,
	) as unknown as typeof window.matchMedia
}

function stubViewport(width: number, height: number) {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
	Object.defineProperty(window, "innerHeight", { configurable: true, value: height })
}

function panel(): HTMLElement | null {
	return host.querySelector('[role="dialog"]')
}

function launcher(): HTMLButtonElement {
	const button = host.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")
	if (!button) {
		throw new Error("launcher not found")
	}
	return button
}

async function openChat() {
	await act(async () => {
		launcher().click()
	})
	await act(async () => {})
}

// Drag the corner handle; default position anchors the panel's right/bottom
// edges, so moving the pointer up-left grows the panel.
async function dragCornerTo(clientX: number, clientY: number, pointerId = 7) {
	const handle = host.querySelector<HTMLElement>('[data-testid="resize-corner"]')
	const dialog = panel()
	if (!(handle && dialog)) {
		throw new Error("resize handle or panel not found")
	}
	dialog.getBoundingClientRect = () =>
		({ left: 500, right: 820, top: 116, bottom: 500, width: 320, height: 384 }) as DOMRect
	act(() => {
		handle.dispatchEvent(
			Object.assign(new window.MouseEvent("pointerdown", { bubbles: true }), { pointerId, pointerType: "mouse" }),
		)
	})
	act(() => {
		window.dispatchEvent(Object.assign(new window.MouseEvent("pointermove"), { clientX, clientY, pointerId }))
	})
	act(() => {
		window.dispatchEvent(Object.assign(new window.MouseEvent("pointerup"), { pointerId }))
	})
	await act(async () => {})
}

beforeEach(async () => {
	stubMatchMedia(true)
	stubViewport(1024, 768)
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	await act(async () => {
		root.render(<EmbeddedWidget />)
	})
})

afterEach(async () => {
	await act(async () => {
		root.unmount()
	})
	host.remove()
	window.matchMedia = originalMatchMedia
	stubViewport(1024, 768)
})

describe("EmbeddedWidget resize", () => {
	test("shows resize handles on desktop when the chat is open", async () => {
		expect(host.querySelector('[data-testid="resize-corner"]')).toBeNull()

		await openChat()
		expect(host.querySelector('[data-testid="resize-top"]')).not.toBeNull()
		expect(host.querySelector('[data-testid="resize-side"]')).not.toBeNull()
		expect(host.querySelector('[data-testid="resize-corner"]')).not.toBeNull()
	})

	test("hides resize handles when the pointer is coarse", async () => {
		stubMatchMedia(false)

		// Remount so the resize effect picks up the coarse pointer.
		await act(async () => {
			root.unmount()
		})
		host.remove()
		host = document.createElement("div")
		document.body.append(host)
		root = createRoot(host)
		await act(async () => {
			root.render(<EmbeddedWidget />)
		})
		await act(async () => {})

		await openChat()
		expect(panel()).not.toBeNull()
		expect(host.querySelector('[data-testid="resize-corner"]')).toBeNull()
	})

	test("dragging the corner shrinks the panel", async () => {
		await openChat()
		await dragCornerTo(400, 400)
		// right=820, bottom=500 → width=820-400=420 (min 280), height=500-400=100 → clamped to 320
		expect(panel()?.style.width).toBe("420px")
		expect(panel()?.style.height).toBe("320px")
	})

	test("dragging the corner grows the panel up to the anchor", async () => {
		await openChat()
		await dragCornerTo(300, 300)
		// right=820, bottom=500 → width=820-300=520, height=500-300=200 → clamped to 320
		expect(panel()?.style.width).toBe("520px")
		expect(panel()?.style.height).toBe("320px")
	})

	test("clamps the panel to the viewport", async () => {
		await openChat()
		await dragCornerTo(-1000, -1000)
		expect(panel()?.style.width).toBe("992px")
		expect(panel()?.style.height).toBe("736px")
	})

	test("bottom-left position anchors on the left and grows rightwards", async () => {
		await act(async () => {
			root.unmount()
		})
		host.remove()
		host = document.createElement("div")
		document.body.append(host)
		root = createRoot(host)
		await act(async () => {
			root.render(<EmbeddedWidget position="bottom-left" />)
		})
		await act(async () => {})

		await openChat()
		// Panel is anchored at left/bottom; dragging the pointer right grows it.
		await dragCornerTo(600, 300)
		// left=500, bottom=500 → width=600-500=100 → clamped to 280; height=500-300=320
		expect(panel()?.style.width).toBe("280px")
		expect(panel()?.style.height).toBe("320px")
	})

	test("closing and reopening resets the custom size", async () => {
		await openChat()
		await dragCornerTo(300, 300)
		expect(panel()?.style.width).toBe("520px")

		await openChat() // close
		await openChat() // reopen
		expect(panel()?.style.width).toBe("")
	})
})
