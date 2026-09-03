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
