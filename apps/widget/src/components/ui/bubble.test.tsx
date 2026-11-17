import type { Root } from "react-dom/client"

import { afterEach, describe, expect, test } from "bun:test"

await import("@/test-setup")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { Bubble, BubbleContent, BubbleGroup } = await import("./bubble")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

let root: Root | undefined
let host: HTMLElement | undefined

async function render(element: React.ReactElement) {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	await act(async () => root?.render(element))
	return host
}

afterEach(async () => {
	if (root) await act(async () => root?.unmount())
	host?.remove()
	root = undefined
	host = undefined
})

describe("Bubble", () => {
	test("aligns messages to the start by default and to the end on request", async () => {
		const container = await render(
			<BubbleGroup>
				<Bubble>agent</Bubble>
				<Bubble align="end">visitor</Bubble>
			</BubbleGroup>,
		)

		const bubbles = [...container.querySelectorAll<HTMLElement>("[data-slot='bubble']")]
		expect(bubbles.map((bubble) => bubble.dataset.align)).toEqual(["start", "end"])
	})

	test("renders content and forwards extra attributes to the element", async () => {
		const container = await render(
			<Bubble align="end">
				<BubbleContent id="message-body" aria-label="Message body">
					Hello
				</BubbleContent>
			</Bubble>,
		)

		const content = container.querySelector<HTMLElement>("#message-body")
		expect(content?.textContent).toBe("Hello")
		expect(content?.getAttribute("aria-label")).toBe("Message body")
	})
})
