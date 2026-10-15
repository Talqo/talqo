import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"

await import("./test-setup")

describe("built embed bundle", () => {
	beforeEach(() => {
		;(window as { TalqoWidget?: { unmount: () => void } }).TalqoWidget?.unmount()
		document.querySelector("#talqo-widget")?.remove()
		document.querySelectorAll("style").forEach((style) => style.remove())
	})
	test("boots and auto-mounts", () => {
		const code = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")

		expect(() => new Function(code)()).not.toThrow()

		const globalScope = window as { TalqoWidget?: { mount: unknown; unmount: unknown } }
		expect(typeof globalScope.TalqoWidget).toBe("object")
		expect(document.querySelector("#talqo-widget")).not.toBeNull()
	})

	// A host page with no Talqo snippet must not see a stray request from the bundle.
	test("makes no network request when the page carries no embed snippet", () => {
		const code = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")
		using fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch"))

		new Function(code)()

		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test("ships a preview page backed by the production bundle", () => {
		const html = readFileSync(new URL("../dist/preview.html", import.meta.url), "utf8")

		expect(html).toContain('src="./widget.js"')
		expect(html).toContain("data-talqo-preview")
		expect(html).not.toContain('href="./widget.css"')
		expect(html).not.toContain("/src/")
	})

	test("defers its mount until the document is parsed", () => {
		const code = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")

		const hadOwnReadyState = Object.hasOwn(document, "readyState")
		const ownReadyState = Object.getOwnPropertyDescriptor(document, "readyState")
		Object.defineProperty(document, "readyState", { value: "loading", configurable: true })
		try {
			new Function(code)()
			expect(document.querySelector("#talqo-widget")).toBeNull()

			document.dispatchEvent(new Event("DOMContentLoaded"))
			expect(document.querySelector("#talqo-widget")).not.toBeNull()
		} finally {
			if (hadOwnReadyState && ownReadyState) Object.defineProperty(document, "readyState", ownReadyState)
			else Reflect.deleteProperty(document, "readyState")
		}
	})
})
