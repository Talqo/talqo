import { expect, test } from "@playwright/test"

import { adminPassword, adminUsername, loginViaForm } from "./auth-helpers.ts"

test("auth screens expose theme and language controls", async ({ page }) => {
	await page.goto("/login")

	await page.getByRole("button", { name: "Switch to dark theme" }).click()
	await expect(page.locator("html")).toHaveClass(/dark/)

	await page.getByLabel("Language: English").click()
	await page.getByRole("option", { name: "中文" }).click()
	await expect(page.getByRole("heading", { name: "登录" })).toBeVisible()
	await expect(page.getByLabel("确认密码")).toHaveCount(0)
})

test("root redirects to login when setup status is unavailable", async ({ page }) => {
	await page.route("**/api/setup", (route) =>
		route.fulfill({ body: JSON.stringify({ error: "unavailable" }), contentType: "application/json", status: 500 }),
	)

	await page.goto("/")
	await expect(page).toHaveURL("/login")
})

test("a member changes their own password, and an admin's reset forces the member through a new one", async ({
	page,
}) => {
	const memberUsername = `member_${Date.now()}`
	const memberOriginalPassword = "member-original-password"
	const memberSelfChosenPassword = "member-self-chosen-password"
	const adminResetPassword = "admin-reset-password-000"

	// The admin account was already bootstrapped by auth.setup.ts (one admin, ever).
	await page.goto("/login")
	await loginViaForm(page, adminUsername, adminPassword)
	await expect(page).toHaveURL("/dashboard")

	await page.getByRole("link", { name: "Invitations" }).click()
	await page.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await page.getByLabel("Invitation link:").inputValue()
	const token = new URL(inviteUrl).searchParams.get("token")
	if (!token) throw new Error(`Could not find an invitation token in URL: ${inviteUrl}`)
	await page.getByRole("button", { name: "Log out" }).click()

	await page.goto(`/accept-invite?token=${token}`)
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberOriginalPassword)
	await page.getByLabel("Confirm password").fill(memberOriginalPassword)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/login")

	// The member changes their own password; the server invalidates the session, landing back on login.
	await loginViaForm(page, memberUsername, memberOriginalPassword)
	await expect(page).toHaveURL("/dashboard")
	await page.getByRole("link", { name: "Account" }).click()
	await page.getByLabel("Current password").fill(memberOriginalPassword)
	await page.getByLabel("New password", { exact: true }).fill(memberSelfChosenPassword)
	await page.getByLabel("Confirm new password").fill(memberSelfChosenPassword)
	await page.getByRole("button", { name: "Change password" }).click()
	await expect(page).toHaveURL("/login")

	await loginViaForm(page, memberUsername, memberSelfChosenPassword)
	await expect(page).toHaveURL("/dashboard")
	await page.getByRole("button", { name: "Log out" }).click()

	// The admin resets the member's password from the Users page.
	await loginViaForm(page, adminUsername, adminPassword)
	await page.getByRole("link", { name: "Users" }).click()
	await expect(page).toHaveURL("/dashboard/users")

	const adminRow = page.locator("[data-slot=card]", { hasText: adminUsername })
	await expect(adminRow.getByRole("button", { name: "Reset password" })).toBeDisabled()

	const memberRow = page.locator("[data-slot=card]", { hasText: memberUsername })
	await expect(memberRow.getByText("Pending password change")).toHaveCount(0)
	await memberRow.getByRole("button", { name: "Reset password" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("New password").fill(adminResetPassword)
	await dialog.getByLabel("Confirm new password").fill(adminResetPassword)
	await dialog.getByRole("button", { name: "Reset password" }).click()
	await expect(page.getByText("Password reset.")).toBeVisible()
	await expect(memberRow.getByText("Pending password change")).toBeVisible()
	await page.getByRole("button", { name: "Log out" }).click()

	// The member's old password no longer works, and the admin-set one forces a new-password screen.
	await loginViaForm(page, memberUsername, memberSelfChosenPassword)
	await expect(page.getByRole("alert")).toBeVisible()
	await expect(page).toHaveURL("/login")

	await loginViaForm(page, memberUsername, adminResetPassword)
	await expect(page).toHaveURL("/force-password-change")

	// Navigating straight to a dashboard route mid-flow bounces back to the forced screen.
	await page.goto("/dashboard/agents")
	await expect(page).toHaveURL("/force-password-change")

	// No current-password field here: logging in with the admin-set password is itself the proof.
	const memberFinalPassword = "member-final-chosen-password"
	await page.getByLabel("New password", { exact: true }).fill(memberFinalPassword)
	await page.getByLabel("Confirm new password").fill(memberFinalPassword)
	await page.getByRole("button", { name: "Set new password" }).click()
	await expect(page).toHaveURL("/login")

	await loginViaForm(page, memberUsername, memberFinalPassword)
	await expect(page).toHaveURL("/dashboard")
})
