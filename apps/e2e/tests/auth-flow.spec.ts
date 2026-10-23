import { expect, type Page, test } from "@playwright/test"

import { logIn } from "./log-in"

const ADMIN = { username: "admin", password: "admin123" }

const createdMembers: string[] = []

test.afterEach(async ({ request }) => {
	if (createdMembers.length === 0) return
	await expect(await request.post("/api/auth/login", { data: ADMIN })).toBeOK()
	const { users } = (await (await request.get("/api/users")).json()) as { users: { id: string; username: string }[] }
	await Promise.all(
		createdMembers.splice(0).map(async (username) => {
			const user = users.find((candidate) => candidate.username === username)
			if (user) await expect(await request.delete(`/api/users/${user.id}`)).toBeOK()
		}),
	)
})

// Disposable member, so password-mutating tests never touch the shared seed accounts.
async function inviteMember(page: Page, username: string, password: string) {
	await logIn(page, ADMIN)
	await page.getByRole("link", { name: "Users" }).click()
	await page.getByRole("button", { name: "Invite a member" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await dialog.getByLabel("Invitation link:").inputValue()
	expect(new URL(inviteUrl).searchParams.get("token")).toBeTruthy()
	// The dialog is modal, so close it before reaching the header controls.
	await page.keyboard.press("Escape")
	await page.getByRole("button", { name: "Log out" }).click()

	await page.goto(inviteUrl)
	await page.getByLabel("Username").fill(username)
	await page.getByLabel("Password", { exact: true }).fill(password)
	await page.getByLabel("Confirm password").fill(password)
	await page.getByRole("button", { name: "Create account" }).click()
	// Accepting an invitation signs the member straight in.
	await expect(page).toHaveURL("/dashboard/account")
	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
}

test("admin selects invitation roles and the member lands signed in with that access", async ({ page }) => {
	await logIn(page, ADMIN)

	await page.getByRole("link", { name: "Users" }).click()
	await expect(page).toHaveURL("/dashboard/users")
	await page.getByRole("button", { name: "Invite a member" }).click()

	const dialog = page.getByRole("dialog")
	await expect(dialog.getByRole("heading", { name: "Invite a member" })).toBeVisible()
	await expect(dialog.getByRole("checkbox", { name: "Default", exact: true })).toBeChecked()
	await dialog.getByRole("checkbox", { name: "Default", exact: true }).uncheck()
	await dialog.getByRole("checkbox", { name: "Support", exact: true }).check()
	await dialog.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await dialog.getByLabel("Invitation link:").inputValue()
	expect(inviteUrl).toMatch(/^https?:\/\//)
	expect(new URL(inviteUrl).searchParams.get("token")).toBeTruthy()

	const memberUsername = `member_${Date.now()}`
	const memberPassword = "member-original-password"
	createdMembers.push(memberUsername)

	await page.goto(inviteUrl)
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberPassword)
	await page.getByLabel("Confirm password").fill(memberPassword)
	await page.getByRole("button", { name: "Create account" }).click()

	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("link", { name: "Conversations", exact: true })).toBeVisible()
	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)

	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
	await page.goto("/dashboard/users")
	await expect(page).toHaveURL("/login")
})

test("an admin resets a member's password and forces them through a new one", async ({ page }) => {
	const memberUsername = `member_${Date.now()}_reset`
	const originalPassword = "member-original-password"
	const adminResetPassword = "admin-reset-password-000"
	const memberFinalPassword = "member-final-chosen-password"
	createdMembers.push(memberUsername)

	await inviteMember(page, memberUsername, originalPassword)

	await logIn(page, ADMIN)
	await page.getByRole("link", { name: "Users" }).click()
	await expect(page).toHaveURL("/dashboard/users")

	const adminRow = page.locator("[data-slot=card]", { hasText: ADMIN.username })
	await expect(adminRow.getByRole("button", { name: "Reset password" })).toBeDisabled()

	const memberRow = page.locator("[data-slot=card]", { hasText: memberUsername })
	await expect(memberRow.getByText("Pending password change")).toHaveCount(0)
	await memberRow.getByRole("button", { name: "Reset password" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("New password", { exact: true }).fill(adminResetPassword)
	await dialog.getByLabel("Confirm new password").fill(adminResetPassword)
	await dialog.getByRole("button", { name: "Reset password" }).click()
	await expect(page.getByText("Password reset.")).toBeVisible()
	await expect(memberRow.getByText("Pending password change")).toBeVisible()
	await page.getByRole("button", { name: "Log out" }).click()

	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(originalPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page.getByRole("alert")).toBeVisible()
	await expect(page).toHaveURL("/login")

	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(adminResetPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/force-password-change")

	await page.goto("/dashboard/agents")
	await expect(page).toHaveURL("/force-password-change")

	await page.getByLabel("New password", { exact: true }).fill(memberFinalPassword)
	await page.getByLabel("Confirm new password").fill(memberFinalPassword)
	await page.getByRole("button", { name: "Set new password" }).click()

	await expect(page).toHaveURL("/dashboard/account")
})

test("an admin deletes a member, who can no longer log in", async ({ page }) => {
	const memberUsername = `member_${Date.now()}_delete`
	const memberPassword = "member-doomed-password"

	// The test deletes the member itself, so it does not register with createdMembers cleanup.
	await inviteMember(page, memberUsername, memberPassword)

	await logIn(page, ADMIN)
	await page.getByRole("link", { name: "Users" }).click()
	await expect(page).toHaveURL("/dashboard/users")

	const adminRow = page.locator("[data-slot=card]", { hasText: ADMIN.username })
	await expect(adminRow.getByRole("button", { name: "Delete", exact: true })).toBeDisabled()

	const memberRow = page.locator("[data-slot=card]", { hasText: memberUsername })
	await memberRow.getByRole("button", { name: "Delete", exact: true }).click()
	const dialog = page.getByRole("dialog")
	const confirm = dialog.getByRole("button", { name: "Delete user" })
	await expect(dialog.getByRole("textbox")).toHaveCount(0)
	await expect(confirm).toBeEnabled()
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
	await expect(memberRow).toBeVisible()
	await memberRow.getByRole("button", { name: "Delete", exact: true }).click()
	await confirm.click()
	await expect(dialog).toBeHidden()
	await expect(memberRow).toHaveCount(0)
	await page.getByRole("button", { name: "Log out" }).click()

	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page.getByRole("alert")).toBeVisible()
	await expect(page).toHaveURL("/login")
})
