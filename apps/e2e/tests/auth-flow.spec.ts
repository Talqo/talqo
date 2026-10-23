import { expect } from "@playwright/test"

import { test as applicationTest } from "./application"
import { createInvitedMember } from "./invited-member"
import { ADMIN, logIn, openDashboard } from "./log-in"

const test = applicationTest.extend<{ member: { username: string; password: string } }>({
	member: async ({ request }, use) => {
		const member = { username: crypto.randomUUID().replaceAll("-", ""), password: "member-original-password" }
		await use(member)
		await expect(await request.post("/api/auth/login", { data: ADMIN })).toBeOK()
		const response = await request.get("/api/users")
		await expect(response).toBeOK()
		const { users } = (await response.json()) as { users: { id: string; username: string }[] }
		const user = users.find(({ username }) => username === member.username)
		if (user) await expect(await request.delete(`/api/users/${user.id}`)).toBeOK()
	},
})

test("admin selects invitation roles and the member lands signed in with that access", async ({ page, member }) => {
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

	const { username: memberUsername, password: memberPassword } = member

	await page.keyboard.press("Escape")
	await page.getByRole("button", { name: "Log out" }).click()
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

test("an admin resets a member's password and forces them through a new one", async ({ page, request, member }) => {
	const { username: memberUsername, password: originalPassword } = member
	const adminResetPassword = "admin-reset-password-000"
	const memberFinalPassword = "member-final-chosen-password"

	await createInvitedMember(request, { username: memberUsername, password: originalPassword })

	await openDashboard(page)
	await page.getByRole("link", { name: "Users" }).click()
	await expect(page).toHaveURL("/dashboard/users")

	const adminRow = page.locator("[data-user-id]", { hasText: ADMIN.username })
	await expect(adminRow.getByRole("button", { name: "Reset password" })).toHaveCount(0)

	const memberRow = page.locator("[data-user-id]", { hasText: memberUsername })
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
	await page.getByRole("button", { name: "Log out" }).click()
	await logIn(page, { username: memberUsername, password: memberFinalPassword })
})

test("an admin can delete a member but cannot delete their own account", async ({ page, request, member }) => {
	const { username: memberUsername, password: memberPassword } = member
	await createInvitedMember(request, { username: memberUsername, password: memberPassword })

	await openDashboard(page)
	await page.getByRole("link", { name: "Account", exact: true }).click()
	await expect(page.getByText("The administrator account cannot be deleted.", { exact: false })).toBeVisible()
	await expect(page.getByText("Deleting your account signs you out everywhere", { exact: false })).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Delete account", exact: true })).toHaveCount(0)
	await page.getByRole("link", { name: "Users" }).click()
	await expect(page).toHaveURL("/dashboard/users")

	const adminRow = page.locator("[data-user-id]", { hasText: ADMIN.username })
	await expect(adminRow.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0)

	const memberRow = page.locator("[data-user-id]", { hasText: memberUsername })
	await memberRow.getByRole("button", { name: "Delete", exact: true }).click()
	const dialog = page.getByRole("dialog")
	const confirm = dialog.getByRole("button", { name: "Delete user" })
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

test("a member cancels then deletes their own account from Account settings", async ({ page, request, member }) => {
	const { username, password } = member
	await createInvitedMember(request, member)
	await logIn(page, { username, password })
	await page.getByRole("link", { name: "Account", exact: true }).click()
	await page.getByRole("button", { name: "Delete account", exact: true }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
	await expect(dialog).toBeHidden()
	await expect(page).toHaveURL("/dashboard/account")
	await page.getByRole("button", { name: "Delete account", exact: true }).click()
	await dialog.getByRole("button", { name: "Delete account", exact: true }).click()
	await expect(page).toHaveURL("/login")
	await page.goto("/dashboard/account")
	await expect(page).toHaveURL("/login")
})
