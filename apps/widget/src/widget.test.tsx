import { beforeEach, describe, expect, spyOn, test } from "bun:test"

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
		expect(() => mount("#")).not.toThrow()
		expect(document.querySelector("#talqo-widget")).toBeNull()
	})

	test("warns and renders no widget without an embed token", () => {
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		mount()
		expect(document.querySelector("#talqo-widget")?.childElementCount).toBe(0)
		expect(warning).toHaveBeenCalledWith("TalqoWidget: embed token or API origin missing")
	})

	test("does not reach the network without a widget token", () => {
		using fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch"))

		mount()

		expect(fetchSpy).not.toHaveBeenCalled()
	})
})
