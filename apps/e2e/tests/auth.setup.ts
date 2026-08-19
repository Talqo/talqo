import { expect, test } from "@playwright/test"

import { adminPassword, adminUsername, loginViaForm } from "./auth-helpers.ts"

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
	await loginViaForm(page, adminUsername, adminPassword)
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
	await loginViaForm(page, memberUsername, memberPassword)
	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("heading", { name: "Welcome to Talqo" })).toBeVisible()

	// Logging out removes access client-side so a stale UI cannot keep acting on the member session.
	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
	await page.goto("/dashboard/invitations")
	await expect(page.getByText("You need to log in to invite a member.")).toBeVisible()
})
