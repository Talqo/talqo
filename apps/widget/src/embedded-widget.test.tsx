import type { Root } from "react-dom/client"

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

await import("./test-setup")

// Scoped to this file: widget.test.tsx mounts outside act() on purpose.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { EmbeddedWidget } = await import("./embedded-widget")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

function render(element: React.ReactElement): HTMLElement {
	const container = document.createElement("div")
	document.body.append(container)
	const root = createRoot(container)
	act(() => root.render(element))
	return container
}

function widgetRoot(container: HTMLElement): HTMLElement {
	const root = container.querySelector(".talqo-widget")
	if (!(root instanceof HTMLElement)) {
		throw new Error("widget root not rendered")
	}
	return root
}

describe("appearance resolution", () => {
	test("writes the light scheme's five colors as custom properties by default", () => {
		const root = widgetRoot(render(<EmbeddedWidget appearance={{ theme: "light" }} />))
		expect(root.style.getPropertyValue("--talqo-primary-input")).toBe("#1a7f4b")
		expect(root.style.getPropertyValue("--talqo-text-on-primary-input")).toBe("#ffffff")
		expect(root.style.getPropertyValue("--talqo-background-input")).toBe("#ffffff")
		expect(root.style.getPropertyValue("--talqo-surface-input")).toBe("#f5f5f5")
		expect(root.style.getPropertyValue("--talqo-text-input")).toBe("#171717")
	})

	test("writes the given light scheme's colors", () => {
		const root = widgetRoot(
			render(
				<EmbeddedWidget
					appearance={{
						theme: "light",
						light: {
							primary: "#123456",
							textOnPrimary: "#fefefe",
							background: "#fefefe",
							surface: "#eeeeee",
							text: "#101010",
						},
					}}
				/>,
			),
		)
		expect(root.style.getPropertyValue("--talqo-primary-input")).toBe("#123456")
		expect(root.style.getPropertyValue("--talqo-background-input")).toBe("#fefefe")
		expect(root.style.getPropertyValue("--talqo-surface-input")).toBe("#eeeeee")
		expect(root.style.getPropertyValue("--talqo-text-input")).toBe("#101010")
	})

	test("falls back per field so one bad color cannot blank the palette", () => {
		const root = widgetRoot(
			render(
				<EmbeddedWidget appearance={{ theme: "light", light: { primary: "not-a-color", background: "#0a0a0a" } }} />,
			),
		)
		expect(root.style.getPropertyValue("--talqo-primary-input")).toBe("#1a7f4b")
		expect(root.style.getPropertyValue("--talqo-background-input")).toBe("#0a0a0a")
	})

	test("ignores an unsupported position and keeps the default placement", () => {
		const root = widgetRoot(render(<EmbeddedWidget appearance={{ position: "top-left" }} />))
		expect(root.className).toContain("tw:right-4")
	})
})

describe("color scheme", () => {
	test("paints the light scheme's own colors in light mode", () => {
		const root = widgetRoot(
			render(<EmbeddedWidget appearance={{ theme: "light", light: { background: "#ffffff" } }} />),
		)
		expect(root.dataset.scheme).toBe("light")
		expect(root.style.getPropertyValue("--talqo-background-input")).toBe("#ffffff")
	})

	test("paints the dark scheme's own colors in dark mode, not a derivation of light", () => {
		const root = widgetRoot(
			render(
				<EmbeddedWidget
					appearance={{ theme: "dark", light: { background: "#ffffff" }, dark: { background: "#0a0a0a" } }}
				/>,
			),
		)
		expect(root.dataset.scheme).toBe("dark")
		expect(root.style.getPropertyValue("--talqo-background-input")).toBe("#0a0a0a")
	})

	test("changing only the light text color leaves the light background untouched", () => {
		const root = widgetRoot(
			render(<EmbeddedWidget appearance={{ theme: "light", light: { background: "#ffffff", text: "#ff00ff" } }} />),
		)
		expect(root.style.getPropertyValue("--talqo-background-input")).toBe("#ffffff")
		expect(root.style.getPropertyValue("--talqo-text-input")).toBe("#ff00ff")
	})
})

describe("visitor theme toggle", () => {
	test("is offered when the operator enables it", () => {
		const container = render(<EmbeddedWidget appearance={{ theme: "light", themeToggle: true }} />)
		act(() => {
			container.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")?.click()
		})
		expect(container.querySelector("button[aria-label='Switch to dark theme']")).not.toBeNull()
	})

	test("is withheld when the operator disables it", () => {
		const container = render(<EmbeddedWidget appearance={{ theme: "light", themeToggle: false }} />)
		act(() => {
			container.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")?.click()
		})
		expect(container.querySelector("button[aria-label='Switch to dark theme']")).toBeNull()
	})

	test("overrides the operator default for the visitor", () => {
		const container = render(<EmbeddedWidget appearance={{ theme: "light", themeToggle: true }} />)
		act(() => {
			container.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")?.click()
		})
		act(() => {
			container.querySelector<HTMLButtonElement>("button[aria-label='Switch to dark theme']")?.click()
		})
		expect(widgetRoot(container).dataset.scheme).toBe("dark")
	})
})

describe("title", () => {
	test("falls back to the default title when none is given", () => {
		const container = render(<EmbeddedWidget appearance={{ theme: "light", themeToggle: false }} />)
		act(() => {
			container.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")?.click()
		})
		expect(container.querySelector("h2")?.textContent).toBe("AI Chat")
	})

	test("shows the propagated widget name", () => {
		const container = render(<EmbeddedWidget title="Marketing site" appearance={{ theme: "light" }} />)
		act(() => {
			container.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")?.click()
		})
		expect(container.querySelector("h2")?.textContent).toBe("Marketing site")
	})
})

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

describe("EmbeddedWidget resize", () => {
	let host: HTMLDivElement
	let root: Root

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

	test("shows the corner resize grip on desktop when the chat is open", async () => {
		expect(host.querySelector('[data-testid="resize-corner"]')).toBeNull()

		await openChat()
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

	test("clamps the panel to the viewport, keeping the launcher row below", async () => {
		await openChat()
		await dragCornerTo(-1000, -1000)
		// width: 1024-32=992; height: 768-92=676 (launcher row + top clearance).
		expect(panel()?.style.width).toBe("992px")
		expect(panel()?.style.height).toBe("676px")
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
			root.render(<EmbeddedWidget appearance={{ position: "bottom-left" }} />)
		})
		await act(async () => {})

		await openChat()
		// Panel is anchored at left/bottom; dragging the pointer right grows it.
		await dragCornerTo(600, 300)
		// left=500, bottom=500 → width=600-500=100 → clamped to 280; height=500-300=320
		expect(panel()?.style.width).toBe("280px")
		expect(panel()?.style.height).toBe("320px")
	})

	test("closing and reopening keeps the custom size", async () => {
		await openChat()
		await dragCornerTo(300, 300)
		expect(panel()?.style.width).toBe("520px")

		await openChat() // close
		await openChat() // reopen
		expect(panel()?.style.width).toBe("520px")
	})
})
