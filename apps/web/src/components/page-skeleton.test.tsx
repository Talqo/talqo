import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { PendingPage } = await import("./page-skeleton")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

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

test("announces a pending route with a busy skeleton", async () => {
	await act(async () => root.render(<PendingPage />))

	expect(host.querySelector("output")?.textContent).toBe(t("auth.loading"))
	expect(host.querySelector('[aria-busy="true"]')).not.toBeNull()
})
