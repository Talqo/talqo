import { describe, expect, spyOn, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"

await import("./test-setup")

describe("built embed bundle", () => {
	test("boots without a process global and auto-mounts", () => {
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

	test("injects its scoped stylesheet and emits no separate CSS asset", () => {
		const code = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")

		new Function(code)()

		const injected = [...document.querySelectorAll("style")].map((style) => style.textContent ?? "").join("")
		expect(injected).toContain(".talqo-widget")
		expect(existsSync(new URL("../dist/widget.css", import.meta.url))).toBe(false)
	})

	// Plugin order decides this; unscoped preflight rewrites the host page.
	test("ships no unscoped css", () => {
		const code = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")

		for (const leak of ["@layer base", "@property", "*,:before,:after,::backdrop", ":root"]) {
			expect(code).not.toContain(leak)
		}
	})

	test("defers its mount until the document is parsed", () => {
		const code = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")
		const globalScope = window as { TalqoWidget?: { unmount: () => void } }
		globalScope.TalqoWidget?.unmount()
		document.querySelector("#talqo-widget")?.remove()

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
