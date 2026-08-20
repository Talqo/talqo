import { beforeEach, describe, expect, test } from "bun:test"

const { mount, unmount } = await import("./test-setup").then(() => import("./widget"))

describe("widget mount", () => {
	beforeEach(() => {
		unmount()
		document.querySelector("#talqo-widget")?.remove()
	})

	test("creates its own mount root when the page has none", () => {
		expect(document.querySelector("#talqo-widget")).toBeNull()
		mount()
		const element = document.querySelector("#talqo-widget")
		expect(element).not.toBeNull()
		expect(element?.parentElement).toBe(document.body)
	})

	test("mounts into an existing target element", () => {
		const element = document.createElement("div")
		element.id = "talqo-widget"
		document.body.append(element)
		mount()
		expect(document.querySelector("#talqo-widget")).toBe(element)
	})

	test("warns and creates nothing for a missing explicit target", () => {
		mount("#missing-target")
		expect(document.querySelector("#missing-target")).toBeNull()
	})

	test("warns instead of throwing for an invalid selector target", () => {
		expect(() => mount("foo")).not.toThrow()
		expect(document.querySelector("#talqo-widget")).toBeNull()
	})

	// No embed script carries a token in this harness, so there is nothing to fetch and
	// the widget must paint straight away rather than sitting invisible forever.
	test("paints immediately when there is no widget token to fetch", () => {
		mount()
		const widget = document.querySelector(".talqo-widget")
		expect(widget).not.toBeNull()
		expect((widget as HTMLElement).style.visibility).toBe("")
	})

	test("does not reach the network without a widget token", () => {
		let called = false
		const original = globalThis.fetch
		globalThis.fetch = (() => {
			called = true
			return Promise.reject(new Error("unexpected fetch"))
		}) as typeof fetch

		try {
			mount()
			expect(called).toBe(false)
		} finally {
			globalThis.fetch = original
		}
	})
})
