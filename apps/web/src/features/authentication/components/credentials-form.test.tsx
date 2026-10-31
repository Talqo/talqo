import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { CredentialsForm } = await import("./credentials-form")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root

async function renderForm(props: { pendingLabel?: string; requireConfirmation?: boolean; submitting: boolean }) {
	await act(async () =>
		root.render(
			<CredentialsForm
				error={null}
				onSubmit={() => undefined}
				requireConfirmation={props.requireConfirmation ?? false}
				pendingLabel={props.pendingLabel}
				submitLabel={t("auth.login.submit")}
				submitting={props.submitting}
			/>,
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

describe("CredentialsForm", () => {
	test("shows the pending label while the submit is in flight", async () => {
		await renderForm({ pendingLabel: t("auth.login.pending"), submitting: true })

		const submit = host.querySelector("button[type=submit]")
		expect(submit?.textContent).toBe(t("auth.login.pending"))
		expect(submit?.hasAttribute("disabled")).toBe(true)
	})

	test("marks every field required and says so once", async () => {
		await renderForm({ requireConfirmation: true, submitting: false })

		expect(host.querySelector("#username")?.hasAttribute("required")).toBe(true)
		expect(host.querySelector("#password")?.hasAttribute("required")).toBe(true)
		expect(host.querySelector("#confirmPassword")?.hasAttribute("required")).toBe(true)
		expect(host.textContent).toContain(t("auth.requiredNote"))
	})
})
