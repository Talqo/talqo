import { expect, test, type Page } from "@playwright/test"

const ADMIN = { username: "e2e_admin", password: "correct-horse-battery-staple" }

async function logIn(page: Page, account: { password: string; username: string }) {
	await page.goto("/login")
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}

// Disposable member, so password-mutating tests never touch the shared seed accounts.
async function inviteMember(page: Page, username: string, password: string) {
	await logIn(page, ADMIN)
	await page.getByRole("link", { name: "Invitations" }).click()
	await page.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await page.getByLabel("Invitation link:").inputValue()
	const token = new URL(inviteUrl).searchParams.get("token")
	if (!token) throw new Error(`Could not find an invitation token in URL: ${inviteUrl}`)
	await page.getByRole("button", { name: "Log out" }).click()

	await page.goto(`/accept-invite?token=${token}`)
	await page.getByLabel("Username").fill(username)
	await page.getByLabel("Password", { exact: true }).fill(password)
	await page.getByLabel("Confirm password").fill(password)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/login")
}

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

test("admin invites a member and the member logs in", async ({ page }) => {
	await page.goto("/login")
	await page.getByLabel("Username").fill(ADMIN.username)
	await page.getByLabel("Password", { exact: true }).fill(ADMIN.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")

	await page.getByRole("link", { name: "Invitations" }).click()
	await expect(page).toHaveURL("/dashboard/invitations")
	await expect(page.getByRole("heading", { name: "Invite a member" })).toBeVisible()

	await page.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await page.getByLabel("Invitation link:").inputValue()
	expect(inviteUrl).toMatch(/^https?:\/\//)
	const token = new URL(inviteUrl).searchParams.get("token")
	if (!token) throw new Error(`Could not find an invitation token in URL: ${inviteUrl}`)

	await page.evaluate(() => {
		let attempts = 0
		Object.defineProperty(window.navigator.clipboard, "writeText", {
			configurable: true,
			value: async () => {
				attempts += 1
				if (attempts === 1) throw new Error("Clipboard denied")
			},
		})
	})
	const copyButton = page.getByRole("button", { name: "Copy invitation link" })
	await copyButton.click()
	await expect(page.getByRole("alert")).toContainText("The invitation link could not be copied")
	await copyButton.click()
	await expect(page.getByRole("alert")).toHaveCount(0)
	await expect(page.getByText("Invitation link copied.")).toBeVisible()

	const memberUsername = `member_${Date.now()}`
	const memberPassword = "member-original-password"

	await page.goto(`/accept-invite?token=${token}`)
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberPassword)
	await page.getByLabel("Confirm password").fill(memberPassword)
	await page.getByRole("button", { name: "Create account" }).click()

	await expect(page).toHaveURL("/login")
	await expect(page.getByLabel("Confirm password")).toHaveCount(0)
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("heading", { name: "Welcome to Talqo" })).toBeVisible()

	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
	await page.goto("/dashboard/invitations")
	await expect(page).toHaveURL("/login")
})

test("a member changes their own password and must log back in with it", async ({ page }) => {
	const memberUsername = `member_${Date.now()}_self`
	const originalPassword = "member-original-password"
	const newPassword = "member-self-chosen-password"

	await inviteMember(page, memberUsername, originalPassword)

	await logIn(page, { username: memberUsername, password: originalPassword })
	await page.getByRole("link", { name: "Account", exact: true }).click()
	await page.getByLabel("Current password").fill(originalPassword)
	await page.getByLabel("New password", { exact: true }).fill(newPassword)
	await page.getByLabel("Confirm new password").fill(newPassword)
	await page.getByRole("button", { name: "Change password" }).click()

	await expect(page).toHaveURL("/login")
	await logIn(page, { username: memberUsername, password: newPassword })
})

test("an admin resets a member's password and forces them through a new one", async ({ page }) => {
	const memberUsername = `member_${Date.now()}_reset`
	const originalPassword = "member-original-password"
	const adminResetPassword = "admin-reset-password-000"
	const memberFinalPassword = "member-final-chosen-password"

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
	await expect(page).toHaveURL("/login")

	await logIn(page, { username: memberUsername, password: memberFinalPassword })
})
