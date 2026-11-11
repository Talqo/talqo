import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@talqo/shared"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { CredentialsForm } = await import("./credentials-form")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

type Submission = { password: string; username: string }

let host: HTMLDivElement
let root: Root
let submissions: Submission[]

async function renderForm(
	props: Partial<{
		error: string | null
		invitationRegistration: boolean
		passwordAutoComplete: "current-password" | "new-password"
		pendingLabel: string
		requireConfirmation: boolean
		submitting: boolean
	}> = {},
) {
	await act(async () =>
		root.render(
			<CredentialsForm
				error={props.error ?? null}
				onSubmit={(input) => {
					submissions.push(input)
				}}
				passwordAutoComplete={props.passwordAutoComplete}
				pendingLabel={props.pendingLabel}
				submitLabel={t("auth.login.submit")}
				submitting={props.submitting ?? false}
				{...(props.invitationRegistration ? { invitationRegistration: true } : {})}
				{...(props.requireConfirmation ? { requireConfirmation: true } : {})}
			/>,
		),
	)
}

function field(id: string): HTMLInputElement {
	const element = document.getElementById(id)
	if (!(element instanceof HTMLInputElement)) throw new Error(`${id} input not rendered`)
	return element
}

async function type(id: string, text: string) {
	const element = field(id)
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(element, text)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function submit() {
	await act(async () =>
		host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	)
}

beforeEach(() => {
	submissions = []
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

		const submitButton = host.querySelector("button[type=submit]")
		expect(submitButton?.textContent).toBe(t("auth.login.pending"))
		expect(submitButton?.hasAttribute("disabled")).toBe(true)
	})

	test("marks every field required and says so once", async () => {
		await renderForm({ requireConfirmation: true })

		expect(host.querySelector("#username")?.hasAttribute("required")).toBe(true)
		expect(host.querySelector("#password")?.hasAttribute("required")).toBe(true)
		expect(host.querySelector("#confirmPassword")?.hasAttribute("required")).toBe(true)
		expect(host.textContent).toContain(t("auth.requiredNote"))
	})

	test("submits only the credentials, not the confirmation field", async () => {
		await renderForm({ requireConfirmation: true })
		await type("username", "operator")
		await type("password", "correct-horse")
		await type("confirmPassword", "correct-horse")

		await submit()

		expect(submissions).toEqual([{ username: "operator", password: "correct-horse" }])
	})

	test("describes each invalid field and keeps the submission back", async () => {
		await renderForm({ requireConfirmation: true })

		await submit()

		const username = field("username")
		expect(username.getAttribute("aria-invalid")).toBe("true")
		expect(username.getAttribute("aria-describedby")).toBe("username-error")
		expect(host.querySelector("#username-error")?.textContent).toBe(
			t("auth.credentialsForm.usernameError", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH }),
		)

		const password = field("password")
		expect(password.getAttribute("aria-invalid")).toBe("true")
		expect(password.getAttribute("aria-describedby")).toBe("password-error")
		expect(host.querySelector("#password-error")?.textContent).toBe(
			t("auth.credentialsForm.passwordError", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH }),
		)

		const confirmation = field("confirmPassword")
		expect(confirmation.getAttribute("aria-invalid")).toBe("true")
		expect(confirmation.getAttribute("aria-describedby")).toBe("confirm-password-error")
		expect(host.querySelector("#confirm-password-error")?.textContent).toBe(
			t("auth.credentialsForm.passwordMismatchError"),
		)
		expect(submissions).toEqual([])
	})

	test("shows the server error and the requested password autocomplete", async () => {
		await renderForm({ error: "Invalid username or password.", passwordAutoComplete: "current-password" })

		expect([...host.querySelectorAll("[role=alert]")].map((element) => element.textContent)).toContain(
			"Invalid username or password.",
		)
		expect(field("password").getAttribute("autocomplete")).toBe("current-password")
		expect(host.querySelector("#confirmPassword") === null).toBe(true)
	})

	test("falls back to the submit label and enables the button when idle", async () => {
		await renderForm({ submitting: false })

		const submitButton = host.querySelector("button[type=submit]")
		expect(submitButton?.textContent).toBe(t("auth.login.submit"))
		expect(submitButton?.hasAttribute("disabled")).toBe(false)
		expect(field("password").getAttribute("autocomplete")).toBe("new-password")
	})
})
