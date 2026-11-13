import type { Root } from "react-dom/client"

import { act, createTestHarness } from "@/testing/component-harness"
import { afterEach, beforeEach, expect, test } from "bun:test"

const { PageHeader } = await import("./page-header")

const REFRESH_LABEL = "Refresh"

let host: HTMLDivElement
let root: Root
let harness: ReturnType<typeof createTestHarness>

beforeEach(() => {
	harness = createTestHarness()
	;({ host, root } = harness)
})

afterEach(async () => {
	await harness.dispose()
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
