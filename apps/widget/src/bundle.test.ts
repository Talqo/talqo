import { describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"
import { type AtRule, parse } from "postcss"

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

	test("ships scoped css inside the bundle", () => {
		const code = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")

		new Function(code)()

		const injected = [...document.querySelectorAll("style")].map((style) => style.textContent ?? "").join("")
		expect(injected).toContain(".talqo-widget")

		// Cascade layers resolve before specificity, so anything we leave layered can lose
		// to a host page's own layers; every rule we ship must stand outside them.
		expect(injected).not.toContain("@layer")

		parse(injected).walkRules((rule) => {
			if (rule.parent?.type === "atrule" && (rule.parent as AtRule).name === "keyframes") return
			for (const selector of rule.selectors) {
				expect(selector).toMatch(/\.talqo-widget|\.tw\\:/)
			}
		})
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
