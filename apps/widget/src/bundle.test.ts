import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

// Regression guard for the embed contract: the built IIFE must boot on a
// plain host page. Vite library builds leave host globals like `process`
// undefined, and an unguarded reference in the bundle once stopped the
// widget from mounting entirely. Turbo runs tests after the build.
await import("./test-setup")
// plain host page. Vite library builds leave host globals like `process`
// undefined, and an unguarded reference in the bundle once stopped the
// widget from mounting entirely. Turbo runs tests after the build.

describe("built embed bundle", () => {
	test("boots without a process global and auto-mounts", () => {
		const code = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")

		expect(() => new Function(code)()).not.toThrow()

		const globalScope = window as { TalqoWidget?: { mount: unknown; unmount: unknown } }
		expect(typeof globalScope.TalqoWidget).toBe("object")
		expect(document.querySelector("#talqo-widget")).not.toBeNull()
	})
})
