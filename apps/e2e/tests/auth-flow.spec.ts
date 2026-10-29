import { expect } from "@playwright/test"

import { test as applicationTest } from "./application"
import { web } from "./i18n"
import { createInvitedMember } from "./invited-member"
import { ADMIN, logIn, logOut, openDashboard } from "./log-in"

const test = applicationTest.extend<{ member: { username: string; password: string } }>({
	member: async ({ adminRequest: request }, use) => {
		const member = { username: crypto.randomUUID().replaceAll("-", ""), password: "member-original-password" }
		await use(member)
		const response = await request.get("/api/users")
		await expect(response).toBeOK()
		const { users } = (await response.json()) as { users: { id: string; username: string }[] }
		const user = users.find(({ username }) => username === member.username)
		if (user) await expect(await request.delete(`/api/users/${user.id}`)).toBeOK()
	},
})

test("admin selects invitation roles and the member lands signed in with that access", async ({ page, member }) => {
	await openDashboard(page, ADMIN, "/dashboard/users")
	await page.getByRole("button", { name: web("auth.invitations.heading") }).click()

	const dialog = page.getByRole("dialog")
	await expect(dialog.getByRole("heading", { name: web("auth.invitations.heading") })).toBeVisible()
	await expect(dialog.getByRole("checkbox", { name: "Default", exact: true })).toBeChecked()
	await dialog.getByRole("checkbox", { name: "Default", exact: true }).uncheck()
	await dialog.getByRole("checkbox", { name: "Support", exact: true }).check()
	await dialog.getByRole("button", { name: web("auth.invitations.create") }).click()
	const inviteUrl = await dialog.getByLabel(web("auth.invitations.linkLabel")).inputValue()
	expect(inviteUrl).toMatch(/^https?:\/\//)
	expect(new URL(inviteUrl).searchParams.get("token")).toBeTruthy()

	const { username: memberUsername, password: memberPassword } = member

	await page.keyboard.press("Escape")
	await logOut(page)
	await page.goto(inviteUrl)
	await page.getByLabel(web("auth.credentialsForm.username")).fill(memberUsername)
	await page.getByLabel(web("auth.credentialsForm.password"), { exact: true }).fill(memberPassword)
	await page.getByLabel(web("auth.credentialsForm.confirmPassword")).fill(memberPassword)
	await page.getByRole("button", { name: web("auth.acceptInvite.submit") }).click()

	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("link", { name: web("nav.conversations"), exact: true })).toBeVisible()
	await expect(page.getByRole("link", { name: web("nav.agents"), exact: true })).toHaveCount(0)

	await logOut(page)
	await page.goto("/dashboard/users")
	await expect(page).toHaveURL("/login")
})

test("an admin resets a member's password and forces them through a new one", async ({ page, request, member }) => {
	const { username: memberUsername, password: originalPassword } = member
	const adminResetPassword = "admin-reset-password-000"
	const memberFinalPassword = "member-final-chosen-password"

	await createInvitedMember(request, { username: memberUsername, password: originalPassword })

	await openDashboard(page, ADMIN, "/dashboard/users")

	const adminRow = page.locator("[data-user-id]", { hasText: ADMIN.username })
	await expect(adminRow.getByRole("button", { name: web("users.resetPassword") })).toHaveCount(0)

	const memberRow = page.locator("[data-user-id]", { hasText: memberUsername })
	await expect(memberRow.getByText(web("users.pendingChange"))).toHaveCount(0)
	await memberRow.getByRole("button", { name: web("users.resetPassword") }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel(web("account.newPassword"), { exact: true }).fill(adminResetPassword)
	await dialog.getByLabel(web("account.confirmNewPassword")).fill(adminResetPassword)
	await dialog.getByRole("button", { name: web("users.resetPassword") }).click()
	await expect(page.getByText(web("users.resetSuccess"))).toBeVisible()
	await expect(memberRow.getByText(web("users.pendingChange"))).toBeVisible()
	await logOut(page)

	await page.getByLabel(web("auth.credentialsForm.username")).fill(memberUsername)
	await page.getByLabel(web("auth.credentialsForm.password"), { exact: true }).fill(originalPassword)
	await page.getByRole("button", { name: web("auth.login.submit") }).click()
	await expect(page.getByRole("alert")).toBeVisible()
	await expect(page).toHaveURL("/login")

	await page.getByLabel(web("auth.credentialsForm.username")).fill(memberUsername)
	await page.getByLabel(web("auth.credentialsForm.password"), { exact: true }).fill(adminResetPassword)
	await page.getByRole("button", { name: web("auth.login.submit") }).click()
	await expect(page).toHaveURL("/force-password-change")

	await page.goto("/dashboard/agents")
	await expect(page).toHaveURL("/force-password-change")

	await page.getByLabel(web("account.newPassword"), { exact: true }).fill(memberFinalPassword)
	await page.getByLabel(web("account.confirmNewPassword")).fill(memberFinalPassword)
	await page.getByRole("button", { name: web("auth.forcePasswordChange.submit") }).click()

	await expect(page).toHaveURL("/dashboard/account")
	await logOut(page)
	await logIn(page, { username: memberUsername, password: memberFinalPassword })
})

test("an admin can delete a member but cannot delete their own account", async ({ page, request, member }) => {
	const { username: memberUsername, password: memberPassword } = member
	await createInvitedMember(request, { username: memberUsername, password: memberPassword })

	await openDashboard(page, ADMIN, "/dashboard/account")
	await expect(page.getByRole("heading", { name: web("account.heading"), exact: true })).toBeVisible()
	await expect(page.getByRole("heading", { name: web("account.dangerZone"), exact: true })).toHaveCount(0)
	await expect(page.getByRole("button", { name: web("account.deleteAccount"), exact: true })).toHaveCount(0)
	await page.getByRole("link", { name: web("nav.users") }).click()
	await expect(page).toHaveURL("/dashboard/users")

	const adminRow = page.locator("[data-user-id]", { hasText: ADMIN.username })
	await expect(adminRow.getByRole("button", { name: web("users.delete"), exact: true })).toHaveCount(0)

	const memberRow = page.locator("[data-user-id]", { hasText: memberUsername })
	await memberRow.getByRole("button", { name: web("users.delete"), exact: true }).click()
	const dialog = page.getByRole("dialog")
	const confirm = dialog.getByRole("button", { name: web("users.deleteConfirm") })
	await expect(confirm).toBeEnabled()
	await dialog.getByRole("button", { name: web("common.cancel"), exact: true }).click()
	await expect(memberRow).toBeVisible()
	await memberRow.getByRole("button", { name: web("users.delete"), exact: true }).click()
	await confirm.click()
	await expect(dialog).toBeHidden()
	await expect(memberRow).toHaveCount(0)
	await logOut(page)

	await page.getByLabel(web("auth.credentialsForm.username")).fill(memberUsername)
	await page.getByLabel(web("auth.credentialsForm.password"), { exact: true }).fill(memberPassword)
	await page.getByRole("button", { name: web("auth.login.submit") }).click()
	await expect(page.getByRole("alert")).toBeVisible()
	await expect(page).toHaveURL("/login")
})

test("a member cancels then deletes their own account from Account settings", async ({ page, request, member }) => {
	const { username, password } = member
	await createInvitedMember(request, member)
	await openDashboard(page, { username, password }, "/dashboard/account")
	await page.getByRole("button", { name: web("account.deleteAccount"), exact: true }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("button", { name: web("common.cancel"), exact: true }).click()
	await expect(dialog).toBeHidden()
	await expect(page).toHaveURL("/dashboard/account")
	await page.getByRole("button", { name: web("account.deleteAccount"), exact: true }).click()
	await dialog.getByRole("button", { name: web("account.deleteAccount"), exact: true }).click()
	await expect(page).toHaveURL("/login")
	await page.goto("/dashboard/account")
	await expect(page).toHaveURL("/login")
})

test("mobile navigation focuses the panel, closes on Escape, and restores the toggle", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 720 })
	await openDashboard(page, ADMIN, "/dashboard")
	const toggle = page.getByRole("button", { name: web("header.toggleNavigation") })

	await toggle.click()
	const panel = page.locator("#mobile-navigation")
	await expect(panel).toBeVisible()
	await expect(toggle).toHaveAttribute("aria-expanded", "true")
	await expect(panel.locator("nav a").first()).toBeFocused()

	await page.keyboard.press("Escape")

	await expect(panel).toBeHidden()
	await expect(toggle).toHaveAttribute("aria-expanded", "false")
	await expect(toggle).toBeFocused()

	await toggle.click()
	await panel.getByRole("link", { name: web("nav.dashboard") }).click()
	await expect(panel).toBeHidden()
	await expect(toggle).toBeFocused()
})
