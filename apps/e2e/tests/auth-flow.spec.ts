import { expect, test, type Page } from "@playwright/test"

const ADMIN = { username: "admin", password: "admin123" }

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
	await page.getByRole("link", { name: "Users" }).click()
	await page.getByRole("button", { name: "Invite a member" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await dialog.getByLabel("Invitation link:").inputValue()
	const token = new URL(inviteUrl).searchParams.get("token")
	if (!token) throw new Error(`Could not find an invitation token in URL: ${inviteUrl}`)
	// The dialog is modal, so close it before reaching the header controls.
	await page.keyboard.press("Escape")
	await page.getByRole("button", { name: "Log out" }).click()

	await page.goto(`/accept-invite?token=${token}`)
	await page.getByLabel("Username").fill(username)
	await page.getByLabel("Password", { exact: true }).fill(password)
	await page.getByLabel("Confirm password").fill(password)
	await page.getByRole("button", { name: "Create account" }).click()
	// Accepting an invitation signs the member straight in.
	await expect(page).toHaveURL("/dashboard")
	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
}

test("admin invites a member and the member lands signed in", async ({ page }) => {
	await logIn(page, ADMIN)

	await page.getByRole("link", { name: "Users" }).click()
	await expect(page).toHaveURL("/dashboard/users")
	await page.getByRole("button", { name: "Invite a member" }).click()

	const dialog = page.getByRole("dialog")
	await expect(dialog.getByRole("heading", { name: "Invite a member" })).toBeVisible()
	await dialog.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await dialog.getByLabel("Invitation link:").inputValue()
	expect(inviteUrl).toMatch(/^https?:\/\//)
	const token = new URL(inviteUrl).searchParams.get("token")
	if (!token) throw new Error(`Could not find an invitation token in URL: ${inviteUrl}`)

	const memberUsername = `member_${Date.now()}`
	const memberPassword = "member-original-password"

	await page.goto(`/accept-invite?token=${token}`)
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberPassword)
	await page.getByLabel("Confirm password").fill(memberPassword)
	await page.getByRole("button", { name: "Create account" }).click()

	// An invited member is signed in right after accepting, no login round-trip.
	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("heading", { name: "Welcome to Talqo" })).toBeVisible()

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

	// The forced change keeps the session, landing straight on the dashboard.
	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("heading", { name: "Welcome to Talqo" })).toBeVisible()
})
