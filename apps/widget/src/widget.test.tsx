import { beforeEach, describe, expect, spyOn, test } from "bun:test"

const { mount, unmount } = await import("./test-setup").then(() => import("./widget"))

/** mount() commits outside act(), so the rendered root appears on a later tick. */
async function widgetRoot(): Promise<HTMLElement> {
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const element = document.querySelector(".talqo-widget")
		if (element instanceof HTMLElement) return element
		// eslint-disable-next-line no-await-in-loop -- each tick lets React commit.
		await new Promise((resolve) => setTimeout(resolve, 1))
	}
	throw new Error("widget root never rendered")
}

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

	// No token in this harness, so nothing is fetched and nothing may stay hidden.
	test("paints visible when there is no widget token to fetch", async () => {
		mount()

		expect((await widgetRoot()).style.visibility).toBe("")
	})

	test("does not reach the network without a widget token", () => {
		using fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch"))

		mount()

		expect(fetchSpy).not.toHaveBeenCalled()
	})
})
