import type { Root } from "react-dom/client"

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

await import("./test-setup")

// Scoped to this file: widget.test.tsx mounts outside act() on purpose.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { EmbeddedWidget } = await import("./embedded-widget")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

const mounted: Array<{ container: HTMLElement; root: Root }> = []

function mountTree(element: React.ReactElement): { container: HTMLElement; root: Root } {
	const container = document.createElement("div")
	document.body.append(container)
	const root = createRoot(container)
	act(() => root.render(element))
	const tree = { container, root }
	mounted.push(tree)
	return tree
}

// A mounted panel keeps a dialog and focus trap in the document. Unmount every
// tree this file rendered so later test files start with a clean body.
afterEach(async () => {
	for (const { container, root } of mounted.splice(0)) {
		await act(async () => root.unmount())
		container.remove()
	}
})

function render(element: React.ReactElement): HTMLElement {
	return mountTree(element).container
}

function widgetRoot(container: HTMLElement): HTMLElement {
	const root = container.querySelector(".talqo-widget")
	if (!(root instanceof HTMLElement)) {
		throw new Error("widget root not rendered")
	}
	return root
}

function launcherButton(container: HTMLElement): HTMLButtonElement {
	const button = container.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")
	if (!button) throw new Error("launcher not rendered")
	return button
}

async function openPanel(container: HTMLElement): Promise<void> {
	await act(async () => launcherButton(container).click())
}

async function closePanel(container: HTMLElement): Promise<void> {
	await act(async () =>
		container.querySelector<HTMLButtonElement>("dialog header button[aria-label='Close chat']")?.click(),
	)
}

const originalMatchMedia = window.matchMedia

describe("appearance resolution", () => {
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
})

describe("color scheme", () => {
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
})

const DARK_QUERY = "(prefers-color-scheme: dark)"

function stubMediaQueries(initialDark: boolean) {
	const listeners = new Set<{ query: string; type: string; listener: (event: MediaQueryListEvent) => void }>()
	const state = { dark: initialDark }
	window.matchMedia = mock((query: string) => ({
		get matches() {
			return query === DARK_QUERY ? state.dark : query.startsWith("(min-width")
		},
		media: query,
		addEventListener(type: string, listener: (event: MediaQueryListEvent) => void) {
			listeners.add({ query, type, listener })
		},
		removeEventListener(type: string, listener: (event: MediaQueryListEvent) => void) {
			for (const entry of listeners) {
				if (entry.query === query && entry.type === type && entry.listener === listener) listeners.delete(entry)
			}
		},
		addListener: () => {},
		removeListener: () => {},
		onchange: null,
		dispatchEvent: () => false,
	})) as unknown as typeof window.matchMedia
	return {
		setDark(matches: boolean) {
			state.dark = matches
			for (const entry of listeners) {
				if (entry.query === DARK_QUERY && entry.type === "change") entry.listener({ matches } as MediaQueryListEvent)
			}
		},
		darkListeners: () => [...listeners].filter((entry) => entry.query === DARK_QUERY).length,
	}
}

describe("system theme", () => {
	afterEach(() => {
		window.matchMedia = originalMatchMedia
	})

	test("follows the visitor's OS scheme and stops listening on unmount", async () => {
		const media = stubMediaQueries(false)
		const { container, root } = mountTree(
			<EmbeddedWidget
				appearance={{ theme: "system", light: { background: "#ffffff" }, dark: { background: "#0a0a0a" } }}
			/>,
		)
		const background = () => widgetRoot(container).style.getPropertyValue("--talqo-background-input")
		expect(widgetRoot(container).dataset.scheme).toBe("light")
		expect(background()).toBe("#ffffff")

		await act(async () => media.setDark(true))
		expect(widgetRoot(container).dataset.scheme).toBe("dark")
		expect(background()).toBe("#0a0a0a")

		expect(media.darkListeners()).toBe(1)
		await act(async () => root.unmount())
		expect(media.darkListeners()).toBe(0)
		container.remove()
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

	test("offers the way back to light once the visitor picked dark", async () => {
		const container = render(<EmbeddedWidget appearance={{ theme: "dark", themeToggle: true }} />)
		await openPanel(container)

		const toLight = container.querySelector<HTMLButtonElement>("button[aria-label='Switch to light theme']")
		expect(toLight).not.toBeNull()
		expect(container.querySelector("button[aria-label='Switch to dark theme']")).toBeNull()

		await act(async () => toLight?.click())
		expect(widgetRoot(container).dataset.scheme).toBe("light")
		expect(container.querySelector("button[aria-label='Switch to dark theme']")).not.toBeNull()
	})
})

describe("title", () => {
	test("falls back to the default title when none is given", () => {
		const container = render(<EmbeddedWidget appearance={{ theme: "light", themeToggle: false }} />)
		act(() => {
			container.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")?.click()
		})
		expect(container.querySelector("h2")?.textContent).toBe("AI Chat")
		expect(container.querySelector("dialog")?.getAttribute("aria-label")).toBe("AI Chat")
	})

	test("names the panel after the operator's title", async () => {
		const container = render(<EmbeddedWidget title="Support" />)
		expect(launcherButton(container).getAttribute("aria-label")).toBe("Open chat")
		await openPanel(container)
		expect(launcherButton(container).getAttribute("aria-label")).toBe("Close chat")
		expect(container.querySelector("dialog")?.getAttribute("aria-label")).toBe("Support")
	})
})

describe("language", () => {
	test("sets lang on the widget root from the resolved language", () => {
		const root = widgetRoot(render(<EmbeddedWidget appearance={{ language: "cs" }} />))
		expect(root.getAttribute("lang")).toBe("cs")
	})

	test("falls back to en for an unsupported language", () => {
		const root = widgetRoot(render(<EmbeddedWidget appearance={{ language: "fr" }} />))
		expect(root.getAttribute("lang")).toBe("en")
	})

	test("retranslates when the language changes without remounting", async () => {
		const { container, root } = mountTree(<EmbeddedWidget appearance={{ language: "en" }} />)
		await openPanel(container)
		expect(container.textContent).toContain("Hi there!")

		await act(async () => root.render(<EmbeddedWidget appearance={{ language: "cs" }} />))
		await act(async () => {})

		expect(widgetRoot(container).getAttribute("lang")).toBe("cs")
		expect(container.textContent).toContain("Dobrý den!")
	})
})

describe("dialog semantics", () => {
	test("opens the panel from the start when the preview asks for it", async () => {
		using showModal = spyOn(HTMLDialogElement.prototype, "showModal")
		using parentFocus = spyOn(window.parent, "focus")
		const container = render(<EmbeddedWidget defaultOpen />)

		expect(container.querySelector("dialog")?.open).toBe(true)
		expect(container.querySelector("button[aria-haspopup='dialog']")?.getAttribute("aria-expanded")).toBe("true")
		// Modal focus would trap Tab inside the dashboard's preview frame.
		expect(showModal).not.toHaveBeenCalled()
		expect(parentFocus).toHaveBeenCalledTimes(1)

		// Once the visitor takes over the preview, it behaves like the embed.
		await closePanel(container)
		await openPanel(container)
		expect(showModal).toHaveBeenCalledTimes(1)
	})

	test("does not take focus when it mounts collapsed", () => {
		;(document.activeElement as HTMLElement | null)?.blur()
		expect(document.activeElement).toBe(document.body)
		render(<EmbeddedWidget />)
		expect(document.activeElement).toBe(document.body)
	})

	test("starts collapsed for an embed", () => {
		const container = render(<EmbeddedWidget />)

		expect(container.querySelector("dialog")).toBeNull()
	})

	test("opens modally, focuses the composer, and returns focus to the launcher on Escape", async () => {
		using showModal = spyOn(HTMLDialogElement.prototype, "showModal")
		const container = render(<EmbeddedWidget appearance={{ theme: "light" }} />)
		const launcher = container.querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']")
		if (!launcher) throw new Error("launcher not rendered")

		await act(async () => launcher.click())
		const dialog = container.querySelector("dialog")
		expect(showModal).toHaveBeenCalledTimes(1)
		expect(dialog?.open).toBe(true)
		expect(document.activeElement).toBe(container.querySelector("input[aria-label='Message']"))

		const cancel = new Event("cancel", { cancelable: true })
		await act(async () => dialog?.dispatchEvent(cancel))
		expect(cancel.defaultPrevented).toBe(true)
		expect(container.querySelector("dialog")).toBeNull()
		expect(document.activeElement).toBe(launcher)
	})

	test("closes when the backdrop is pressed and keeps panel presses open", async () => {
		const container = render(<EmbeddedWidget appearance={{ theme: "light" }} />)
		const launcherElement = launcherButton(container)
		await openPanel(container)

		await act(async () =>
			container.querySelector("h2")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
		)
		expect(container.querySelector("dialog")?.open).toBe(true)

		const page = [
			{ clientX: 400, clientY: 300, closes: true }, // left of the panel
			{ clientX: 900, clientY: 300, closes: true }, // right of the panel
			{ clientX: 600, clientY: 100, closes: true }, // above the panel
			{ clientX: 600, clientY: 600, closes: true }, // below the panel
			{ clientX: 600, clientY: 300, closes: false }, // inside the panel
			{ clientX: 500, clientY: 300, closes: false }, // on the left border
			{ clientX: 820, clientY: 300, closes: false }, // on the right border
			{ clientX: 600, clientY: 116, closes: false }, // on the top border
			{ clientX: 600, clientY: 500, closes: false }, // on the bottom border
		] as const
		for (const { clientX, clientY, closes } of page) {
			const dialog = container.querySelector("dialog")
			if (!dialog) throw new Error("panel not rendered")
			dialog.getBoundingClientRect = () =>
				({ left: 500, right: 820, top: 116, bottom: 500, width: 320, height: 384 }) as DOMRect

			await act(async () => dialog.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX, clientY })))
			expect(container.querySelector("dialog") === null).toBe(closes)
			if (closes) await openPanel(container)
		}

		await closePanel(container)
		expect(container.querySelector("dialog")).toBeNull()
		expect(document.activeElement).toBe(launcherElement)
	})

	test("hides the widget only when the deployment reports it unavailable", () => {
		expect(render(<EmbeddedWidget isAvailable />).querySelector("button[aria-haspopup=dialog]")).not.toBeNull()
		expect(render(<EmbeddedWidget isAvailable={false} />).childElementCount).toBe(0)
	})
})

function stubMatchMedia(matches: boolean) {
	window.matchMedia = mock((query: string) => ({
		matches: query.includes("(min-width: 640px) and (pointer: fine)") ? matches : false,
		media: query,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		onchange: null,
		dispatchEvent: () => false,
	}))
}

function stubViewport(width: number, height: number) {
	Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
	Object.defineProperty(window, "innerHeight", { configurable: true, value: height })
}

describe("EmbeddedWidget resize", () => {
	let host: HTMLDivElement
	let root: Root

	function panel(): HTMLElement | null {
		return host.querySelector("dialog[open]")
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

	test("dragging the corner resizes the panel", async () => {
		await openChat()
		const cases = [
			// right=820, bottom=500 → width=820-400=420 (min 280), height=500-400=100 → clamped to 320
			{ clientX: 400, clientY: 400, width: "420px", height: "320px" },
			// right=820, bottom=500 → width=820-300=520, height=500-300=200 → clamped to 320
			{ clientX: 300, clientY: 300, width: "520px", height: "320px" },
		] as const
		for (const { clientX, clientY, width, height } of cases) {
			await dragCornerTo(clientX, clientY)
			expect(panel()?.style.width).toBe(width)
			expect(panel()?.style.height).toBe(height)
		}
	})

	test("clamps the panel to the viewport, keeping the launcher row below", async () => {
		await openChat()
		await dragCornerTo(-1000, -1000)
		// width: 1024-32=992; height: 768-92=676 (launcher row + top clearance).
		expect(panel()?.style.width).toBe("992px")
		expect(panel()?.style.height).toBe("676px")
	})

	const PANEL_RECT = { left: 500, right: 820, top: 116, bottom: 500, width: 320, height: 384 } as DOMRect

	function corner(): HTMLButtonElement {
		const handle = host.querySelector<HTMLButtonElement>("[data-testid='resize-corner']")
		if (!handle) throw new Error("resize handle not found")
		return handle
	}

	function mockPanelRect() {
		const dialog = panel()
		if (!dialog) throw new Error("panel not found")
		dialog.getBoundingClientRect = () => PANEL_RECT
	}

	async function pressKey(key: string): Promise<KeyboardEvent> {
		const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
		await act(async () => corner().dispatchEvent(event))
		return event
	}

	// Clicking the handle toggles between expanded and natural, so reset only when sized.
	async function resetSize() {
		for (let attempt = 0; attempt < 2 && panel()?.style.width !== ""; attempt += 1) {
			await act(async () => corner().dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 })))
		}
	}

	async function keyboardCases(cases: readonly { key: string; width: string; height: string }[]) {
		await openChat()
		mockPanelRect()
		for (const { key, width, height } of cases) {
			await resetSize()
			const event = await pressKey(key)
			expect(event.defaultPrevented).toBe(true)
			expect(panel()?.style.width).toBe(width)
			expect(panel()?.style.height).toBe(height)
		}

		await resetSize()
		const ignored = await pressKey("Tab")
		expect(ignored.defaultPrevented).toBe(false)
		expect(panel()?.style.width).toBe("")
		expect(panel()?.style.height).toBe("")
	}

	test("resizes from the keyboard in every direction without dragging", async () => {
		await keyboardCases([
			{ key: "ArrowLeft", width: "344px", height: "384px" },
			{ key: "ArrowRight", width: "296px", height: "384px" },
			{ key: "ArrowUp", width: "320px", height: "408px" },
			{ key: "ArrowDown", width: "320px", height: "360px" },
		])
	})

	test("mirrors horizontal resizing for a left-anchored panel", async () => {
		await act(async () => root.unmount())
		host.remove()
		host = document.createElement("div")
		document.body.append(host)
		root = createRoot(host)
		await act(async () => root.render(<EmbeddedWidget appearance={{ position: "bottom-left" }} />))
		await act(async () => {})

		await keyboardCases([
			{ key: "ArrowLeft", width: "296px", height: "384px" },
			{ key: "ArrowRight", width: "344px", height: "384px" },
			{ key: "ArrowUp", width: "320px", height: "408px" },
			{ key: "ArrowDown", width: "320px", height: "360px" },
		])
	})

	test("expands and resets the panel from the resize button", async () => {
		await openChat()
		const handle = host.querySelector<HTMLButtonElement>("[data-testid='resize-corner']")
		expect(handle?.getAttribute("aria-label")).toBe("Expand chat")

		await act(async () => {
			handle?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }))
		})
		expect(panel()?.style.width).toBe("448px")
		expect(panel()?.style.height).toBe("560px")
		expect(handle?.getAttribute("aria-label")).toBe("Reset chat size")

		await act(async () => {
			handle?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }))
		})
		expect(panel()?.style.width).toBe("448px")

		await act(async () => {
			handle?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }))
		})
		expect(panel()?.style.width).toBe("")
		expect(panel()?.style.height).toBe("")
		expect(handle?.getAttribute("aria-label")).toBe("Expand chat")
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
