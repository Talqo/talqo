import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"

const { mount, unmount } = await import("./test-setup").then(() => import("./widget"))

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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

	test("floats bottom-right when the embed sets no position", async () => {
		expect(document.querySelector("script[data-talqo-embed-token]")).toBeNull()
		mount()
		await act(async () => {})
		expect(document.querySelector("#talqo-widget .talqo-widget")?.className).toContain("tw:fixed")
	})

	test("warns instead of throwing for an invalid selector target", () => {
		expect(() => mount("foo")).not.toThrow()
		expect(document.querySelector("#talqo-widget")).toBeNull()
	})
})
