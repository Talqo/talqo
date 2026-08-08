import { expect, test } from "@playwright/test"

test("admin bootstraps the app, invites a member, and the member logs in", async ({ page }) => {
	const adminUsername = `admin_${Date.now()}`
	const adminPassword = "correct-horse-battery-staple"

	// Before any admin exists, the dashboard redirects to setup.
	await page.goto("/")
	await expect(page).toHaveURL("/setup")

	await page.getByLabel("Username").fill(adminUsername)
	await page.getByLabel("Password").fill(adminPassword)
	await page.getByRole("button", { name: "Create admin account" }).click()

	// Completing setup logs the new admin in.
	await expect(page).toHaveURL("/login")
	await page.getByLabel("Username").fill(adminUsername)
	await page.getByLabel("Password").fill(adminPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/invitations")

	await page.getByRole("button", { name: "Create invitation" }).click()
	const inviteText = await page.getByText(/Invitation link:/).textContent()
	const token = inviteText?.match(/token=(\S+)/)?.[1]
	if (!token) throw new Error(`Could not find an invitation token on the page: ${inviteText}`)

	const memberUsername = `member_${Date.now()}`
	const memberPassword = "member-original-password"

	await page.goto(`/accept-invite?token=${token}`)
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password").fill(memberPassword)
	await page.getByRole("button", { name: "Create account" }).click()

	// An invited member can accept their invitation and log in.
	await expect(page).toHaveURL("/login")
	await page.getByLabel("Username").fill(memberUsername)
	await page.getByLabel("Password").fill(memberPassword)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/invitations")
	await expect(page.getByRole("button", { name: "Create invitation" })).toBeVisible()
})
