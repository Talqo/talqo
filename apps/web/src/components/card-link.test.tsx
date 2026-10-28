import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { Card, CardContent, CardHeader, CardTitle } = await import("@talqo/ui/components/card")
const { CardLink } = await import("@talqo/ui/components/card-link")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

let host: HTMLDivElement
let root: Root

function renderCard() {
	return act(async () =>
		root.render(
			<Card className="relative">
				<CardHeader>
					<CardTitle level={2}>Shop assistant</CardTitle>
				</CardHeader>
				<CardContent>
					<span>{12}</span>
				</CardContent>
				<CardLink href="#shop" aria-label="Shop assistant" />
			</Card>,
		),
	)
}

beforeEach(() => {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

describe("CardLink", () => {
	test("stretches one focusable link over the card", async () => {
		await renderCard()
		const card = host.querySelector<HTMLElement>("[data-slot='card']")
		const link = card?.querySelector<HTMLAnchorElement>("[data-slot='card-link']")
		if (!card || !link) throw new Error("card link not rendered")

		expect(card.querySelectorAll("a")).toHaveLength(1)
		expect(card.querySelectorAll("button, input, select, textarea, [tabindex]")).toHaveLength(0)
		expect(link.textContent).toBe("")
		expect(link.className).toContain("absolute")
		expect(link.className).toContain("inset-0")

		await act(async () => link.focus())
		expect(document.activeElement).toBe(link)
	})

	test("puts the focus ring on the stretched link and removes the browser outline", async () => {
		await renderCard()
		const link = host.querySelector<HTMLAnchorElement>("[data-slot='card-link']")
		if (!link) throw new Error("card link not rendered")

		expect(link.className).toContain("outline-none")
		expect(link.className).toContain("focus-visible:ring-2")
		expect(link.className).toContain("focus-visible:ring-inset")
	})
})
