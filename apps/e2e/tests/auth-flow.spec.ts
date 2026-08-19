import { expect, test } from "@playwright/test"

// One admin ever: only the bootstrap test below calls /setup, everything else reuses these credentials.
const adminUsername = `admin_${Date.now()}`
const adminPassword = "correct-horse-battery-staple"

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

test("admin bootstraps the app, invites a member, and the member logs in", async ({ page }) => {
	// Before any admin exists, the dashboard redirects to setup.
	await page.goto("/")
	await expect(page).toHaveURL("/setup")

	await page.getByLabel("Username").fill(adminUsername)
	await page.getByLabel("Password", { exact: true }).fill(adminPassword)
	await page.getByLabel("Confirm password").fill("different-password")
	await page.getByRole("button", { name: "Create admin account" }).click()
	await expect(page.getByRole("alert")).toContainText("Passwords do not match.")
	await page.getByLabel("Confirm password").fill(adminPassword)
	await page.getByRole("button", { name: "Create admin account" }).click()

	// Completing setup logs the new admin in.
	await expect(page).toHaveURL("/login")
	await expect(page.getByLabel("Confirm password")).toHaveCount(0)
	await page.getByLabel("Username").fill(adminUsername)
	await page.getByLabel("Password", { exact: true }).fill(adminPassword)
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

	// An invited member can accept their invitation and log in.
	await expect(page).toHaveURL("/login")
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("heading", { name: "Welcome to Talqo" })).toBeVisible()

	// Logging out removes access client-side so a stale UI cannot keep acting on the member session.
	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
	await page.goto("/dashboard/invitations")
	await expect(page.getByText("You need to log in to invite a member.")).toBeVisible()
})

test("a member changes their own password, and an admin's reset forces the member through a new one", async ({
	page,
}) => {
	const memberUsername = `member_${Date.now()}_2`
	const memberOriginalPassword = "member-original-password"
	const memberSelfChosenPassword = "member-self-chosen-password"
	const adminResetPassword = "admin-reset-password-000"

	// The admin account was already bootstrapped by the earlier test in this file (one admin, ever).
	await page.goto("/login")
	await page.getByLabel("Username").fill(adminUsername)
	await page.getByLabel("Password", { exact: true }).fill(adminPassword)
	await page.getByRole("button", { name: "Log in" }).click()
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
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberOriginalPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
	await page.getByRole("link", { name: "Account" }).click()
	await page.getByLabel("Current password").fill(memberOriginalPassword)
	await page.getByLabel("New password", { exact: true }).fill(memberSelfChosenPassword)
	await page.getByLabel("Confirm new password").fill(memberSelfChosenPassword)
	await page.getByRole("button", { name: "Change password" }).click()
	await expect(page).toHaveURL("/login")

	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberSelfChosenPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
	await page.getByRole("button", { name: "Log out" }).click()

	// The admin resets the member's password from the Users page.
	await page.getByLabel("Username").fill(adminUsername)
	await page.getByLabel("Password", { exact: true }).fill(adminPassword)
	await page.getByRole("button", { name: "Log in" }).click()
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
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberSelfChosenPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page.getByRole("alert")).toBeVisible()
	await expect(page).toHaveURL("/login")

	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(adminResetPassword)
	await page.getByRole("button", { name: "Log in" }).click()
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

	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password", { exact: true }).fill(memberFinalPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
})

test.describe("authenticated as the shared admin", () => {
	test.beforeEach(async ({ page }) => {
		// Reuses the admin bootstrapped above via a direct login call, not another /setup attempt.
		await page.request.post("/api/auth/login", { data: { username: adminUsername, password: adminPassword } })
	})

	test("agent journey: create, configure, pause, and embed", async ({ page }) => {
		await page.goto("/dashboard/agents")
		await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()
		await expect(page.getByText("No agents yet.")).toBeVisible()

		await page.getByRole("button", { name: "Create agent" }).click()
		const dialog = page.getByRole("dialog")
		await dialog.getByLabel("Name").fill("Docs helper")
		await dialog.getByLabel("System prompt").fill("You answer questions from the product docs.")
		await dialog.getByLabel("Word blacklist").fill("spam, abuse")
		await dialog.getByRole("button", { name: "Create agent" }).click()

		const card = page.locator("[data-slot=card]", { hasText: "Docs helper" })
		await expect(card).toBeVisible()
		await expect(card.getByText("spam", { exact: true })).toHaveCount(0)
		await expect(card.getByText(/answer questions/)).toHaveCount(0)

		await card.getByRole("button", { name: "Configure" }).click()
		await expect(page.getByRole("heading", { name: "Configure Docs helper" })).toBeVisible()
		await expect(page.getByText("spam", { exact: true })).toBeVisible()
		await page.getByLabel("Name").fill("Docs helper 2")
		await page.getByRole("button", { name: "Save changes" }).click()
		await expect(page.getByText("Saved just now.")).toBeVisible()

		await page.getByRole("button", { name: "Back to agents" }).click()
		const updated = page.locator("[data-slot=card]", { hasText: "Docs helper 2" })
		await expect(updated).toBeVisible()
		await updated.getByRole("switch").click()
		await expect(updated.getByRole("switch")).toHaveAttribute("aria-checked", "false")

		await page.getByRole("link", { name: "Widget", exact: true }).click()
		await page.getByLabel("Agent").click()
		await page.getByRole("option", { name: "Docs helper 2" }).click()
		const widgetCdnUrl = process.env.E2E_WIDGET_CDN_URL
		if (!widgetCdnUrl) throw new Error("E2E_WIDGET_CDN_URL missing — playwright.config.ts provides it")
		const snippet = page.locator("pre")
		await expect(snippet).toContainText(`src="${widgetCdnUrl}"`)
		await expect(snippet).toContainText('data-talqo-agent="local-')
		await expect(snippet).toContainText('data-talqo-language="en"')
		await expect(snippet).toContainText('data-talqo-position="bottom-right"')

		await page.getByLabel("Position").click()
		await page.getByRole("option", { name: "Bottom left" }).click()
		await expect(snippet).toContainText('data-talqo-position="bottom-left"')
		await expect(page.locator("iframe")).toHaveAttribute("src", /position=bottom-left/)
	})

	test("account danger zone stays disabled until the account deletion API is wired up", async ({ page }) => {
		await page.goto("/dashboard/account")
		await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
		await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(1)
		await expect(page.getByRole("button", { name: "Delete account" })).toBeDisabled()
	})
})
