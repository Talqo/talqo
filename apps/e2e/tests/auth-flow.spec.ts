import { expect, test } from "@playwright/test"

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
	const adminUsername = process.env.E2E_ADMIN_USERNAME ?? ""
	const adminPassword = process.env.E2E_OPERATOR_PASSWORD ?? ""

	await page.goto("/login")
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
	await expect(page.getByLabel("Confirm password")).toHaveCount(0)
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
