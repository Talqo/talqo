import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

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
		const original = globalThis.fetch
		let called = false
		globalThis.fetch = (() => {
			called = true
			return Promise.reject(new Error("unexpected fetch"))
		}) as typeof fetch

		try {
			new Function(code)()
			expect(called).toBe(false)
		} finally {
			globalThis.fetch = original
		}
	})
})
