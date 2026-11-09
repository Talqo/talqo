import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { useRouteHeading } = await import("./-route-heading")
const { createRoot } = await import("react-dom/client")
const { act, useRef } = await import("react")

const APP_NAME = "Talqo"

const OUTSIDE_LABEL = "Outside"

let host: HTMLDivElement
let root: Root

function Page({ pathname, heading }: { pathname: string; heading: string }) {
	const main = useRef<HTMLElement>(null)
	useRouteHeading(pathname, main, APP_NAME)
	return (
		<main ref={main}>
			<h1 key={heading} tabIndex={-1}>
				{heading}
			</h1>
			<button type="button" aria-label={OUTSIDE_LABEL} />
		</main>
	)
}

async function renderPage(pathname: string, heading: string) {
	await act(async () => root.render(<Page pathname={pathname} heading={heading} />))
	await settle()
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function headingElement(): HTMLHeadingElement {
	const found = host.querySelector("h1")
	if (!found) throw new Error("Missing heading")
	return found
}

function outsideButton(): HTMLButtonElement {
	const found = host.querySelector("button")
	if (!found) throw new Error("Missing outside button")
	return found
}

beforeEach(() => {
	document.title = ""
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	document.title = ""
})

test("titles the document without stealing focus on first render", async () => {
	await renderPage("/dashboard/account", "Account")

	expect(document.title).toBe(`Account · ${APP_NAME}`)
	expect(document.activeElement === headingElement()).toBe(false)
})

test("trims the heading before titling the document", async () => {
	await renderPage("/dashboard/account", "  Account  ")

	expect(document.title).toBe(`Account · ${APP_NAME}`)
})

test("updates the title when the heading's text node changes", async () => {
	await renderPage("/dashboard/account", "Account")
	const text = headingElement().firstChild
	if (!(text instanceof Text)) throw new Error("Missing heading text node")

	await act(async () => {
		text.data = "Profile"
	})
	await settle()

	expect(document.title).toBe(`Profile · ${APP_NAME}`)
})

test("focuses a new page heading and leaves focus alone for later same-page changes", async () => {
	await renderPage("/dashboard/account", "Account")

	await renderPage("/dashboard/team", "Team")
	expect(document.title).toBe(`Team · ${APP_NAME}`)
	expect(document.activeElement).toBe(headingElement())

	outsideButton().focus()
	await renderPage("/dashboard/team", "Members")
	expect(document.title).toBe(`Members · ${APP_NAME}`)
	expect(document.activeElement).toBe(outsideButton())
})
