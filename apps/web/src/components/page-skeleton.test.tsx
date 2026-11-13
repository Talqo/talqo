import type { Root } from "react-dom/client"

import { act, createTestHarness } from "@/testing/component-harness"
import { afterEach, beforeEach, expect, test } from "bun:test"

const { PendingPage } = await import("./page-skeleton")
const { t } = await import("i18next")

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

test("announces a pending route with a busy skeleton", async () => {
	await act(async () => root.render(<PendingPage />))

	expect(host.querySelector("output")?.textContent).toBe(t("auth.loading"))
	expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
})
