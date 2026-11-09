import { act, createTestHarness, type Root } from "@/testing/component-harness"
import { field, submitForm as submit, typeField as type } from "@/testing/forms"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { ChangePasswordForm } = await import("./change-password-form")
const { t } = await import("i18next")

type Submission = { confirmPassword: string; currentPassword: string; newPassword: string }

let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let submissions: Submission[]

async function renderForm(
	props: Partial<{
		error: string | null
		pendingLabel: string
		status: string
		submitting: boolean
	}> = {},
) {
	await act(async () =>
		root.render(
			<ChangePasswordForm
				error={props.error ?? null}
				onSubmit={(input) => {
					submissions.push(input)
				}}
				pendingLabel={props.pendingLabel}
				status={props.status}
				submitLabel={t("account.changePassword")}
				submitting={props.submitting ?? false}
			/>,
		),
	)
}

beforeEach(() => {
	submissions = []
	harness = createTestHarness()
	;({ host, root } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("ChangePasswordForm", () => {
	test("submits all three passwords when they match", async () => {
		await renderForm()
		await type("current-password", "current-password")
		await type("new-password", "new-password-1")
		await type("confirm-new-password", "new-password-1")

		await submit()

		expect(submissions).toEqual([
			{ currentPassword: "current-password", newPassword: "new-password-1", confirmPassword: "new-password-1" },
		])
	})

	test("focuses the current password when it is missing", async () => {
		await renderForm()
		await submit()

		const current = field("current-password")
		expect(current.getAttribute("aria-invalid")).toBe("true")
		expect(current.getAttribute("aria-describedby")).toBe("current-password-error")
		expect(host.querySelector("#current-password-error")?.textContent).toBe(t("account.currentPasswordRequired"))
		expect(document.activeElement === current).toBe(true)
		expect(submissions).toEqual([])
	})

	test("focuses the new password when it is too short", async () => {
		await renderForm()
		await type("current-password", "current-password")
		await type("new-password", "short")
		await type("confirm-new-password", "short")

		await submit()

		const next = field("new-password")
		expect(next.getAttribute("aria-invalid")).toBe("true")
		expect(next.getAttribute("aria-describedby")).toBe("new-password-error")
		expect(host.querySelector("#new-password-error")?.textContent).toBe(
			t("account.newPasswordError", { min: 8, max: 128 }),
		)
		expect(document.activeElement === next).toBe(true)
		expect(submissions).toEqual([])
	})

	test("focuses the confirmation when the passwords differ", async () => {
		await renderForm()
		await type("current-password", "current-password")
		await type("new-password", "new-password-1")
		await type("confirm-new-password", "new-password-2")

		await submit()

		const confirmation = field("confirm-new-password")
		expect(confirmation.getAttribute("aria-invalid")).toBe("true")
		expect(confirmation.getAttribute("aria-describedby")).toBe("confirm-new-password-error")
		expect(host.querySelector("#confirm-new-password-error")?.textContent).toBe(t("account.passwordMismatchError"))
		expect(document.activeElement === confirmation).toBe(true)
		expect(submissions).toEqual([])
	})

	test("shows the server error and pending state while submitting", async () => {
		await renderForm({
			error: "Current password is incorrect.",
			pendingLabel: t("account.changingPassword"),
			submitting: true,
		})

		const alerts = [...host.querySelectorAll("[role=alert]")].map((element) => element.textContent)
		expect(alerts).toContain("Current password is incorrect.")
		const button = host.querySelector("button[type=submit]")
		expect(button?.textContent).toBe(t("account.changingPassword"))
		expect(button?.hasAttribute("disabled")).toBe(true)
	})

	test("falls back to the submit label and shows status only until the form is dirty", async () => {
		await renderForm({ status: t("account.passwordSaved"), submitting: true })

		const button = host.querySelector("button[type=submit]")
		expect(button?.textContent).toBe(t("account.changePassword"))
		expect(host.textContent).toContain(t("account.passwordSaved"))

		await act(async () =>
			root.render(
				<ChangePasswordForm
					error={null}
					onSubmit={() => undefined}
					status={t("account.passwordSaved")}
					submitLabel={t("account.changePassword")}
					submitting={false}
				/>,
			),
		)
		expect(host.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(true)
		await type("current-password", "current-password")
		expect(host.textContent).not.toContain(t("account.passwordSaved"))
		expect(host.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(false)
	})
})
