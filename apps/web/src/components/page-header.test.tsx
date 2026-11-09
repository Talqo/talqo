import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { PageHeader } = await import("./page-header")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

const REFRESH_LABEL = "Refresh"

let host: HTMLDivElement
let root: Root

beforeEach(() => {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

test("makes the page heading programmatically focusable without a tab stop", async () => {
	await act(async () => root.render(<PageHeader title="Account" />))

	const heading = host.querySelector("h1")
	expect(heading?.textContent).toBe("Account")
	expect(heading?.tabIndex).toBe(-1)
	expect(host.querySelector("p") === null).toBe(true)
})

test("renders the optional description and actions", async () => {
	await act(async () =>
		root.render(
			<PageHeader
				title="Account"
				description="Manage your account"
				actions={<button type="button" aria-label={REFRESH_LABEL} />}
			/>,
		),
	)

	expect(host.querySelector("p")?.textContent).toBe("Manage your account")
	expect(host.querySelector("button")).not.toBeNull()
})
