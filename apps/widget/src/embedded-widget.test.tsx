import { describe, expect, test } from "bun:test"

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
	test("writes the four palette inputs as custom properties", () => {
		const root = widgetRoot(
			render(
				<EmbeddedWidget
					appearance={{
						primary: "#123456",
						primaryForeground: "#ffffff",
						background: "#fefefe",
						foreground: "#101010",
					}}
				/>,
			),
		)
		expect(root.style.getPropertyValue("--talqo-primary-input")).toBe("#123456")
		expect(root.style.getPropertyValue("--talqo-primary-foreground-input")).toBe("#ffffff")
		expect(root.style.getPropertyValue("--talqo-background-input")).toBe("#fefefe")
		expect(root.style.getPropertyValue("--talqo-foreground-input")).toBe("#101010")
	})

	test("falls back per field so one bad color cannot blank the palette", () => {
		const root = widgetRoot(render(<EmbeddedWidget appearance={{ primary: "not-a-color", background: "#0a0a0a" }} />))
		expect(root.style.getPropertyValue("--talqo-primary-input")).toBe("#1a7f4b")
		expect(root.style.getPropertyValue("--talqo-background-input")).toBe("#0a0a0a")
	})

	test("ignores an unsupported position and keeps the default placement", () => {
		const root = widgetRoot(render(<EmbeddedWidget appearance={{ position: "top-left" }} />))
		expect(root.className).toContain("tw:right-4")
	})
})

describe("color scheme", () => {
	test("renders a light palette in light mode without inverting", () => {
		const root = widgetRoot(render(<EmbeddedWidget appearance={{ theme: "light", background: "#ffffff" }} />))
		expect(root.dataset.scheme).toBe("light")
		expect(root.className).not.toContain("talqo-invert")
	})

	test("inverts the surface pair when a light palette is asked for dark", () => {
		const root = widgetRoot(render(<EmbeddedWidget appearance={{ theme: "dark", background: "#ffffff" }} />))
		expect(root.dataset.scheme).toBe("dark")
		expect(root.className).toContain("talqo-invert")
	})

	test("does not invert a dark palette asked for dark", () => {
		const root = widgetRoot(
			render(<EmbeddedWidget appearance={{ theme: "dark", background: "#0a0a0a", foreground: "#fafafa" }} />),
		)
		expect(root.dataset.scheme).toBe("dark")
		expect(root.className).not.toContain("talqo-invert")
	})

	test("inverts a dark palette asked for light", () => {
		const root = widgetRoot(
			render(<EmbeddedWidget appearance={{ theme: "light", background: "#0a0a0a", foreground: "#fafafa" }} />),
		)
		expect(root.className).toContain("talqo-invert")
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
