import { expect, test, type Page } from "@playwright/test"

const TEST_PASSWORD = "correct-horse-battery-staple"
const OPERATOR = { username: "e2e_granted", password: TEST_PASSWORD }
const VIEWER = { username: "e2e_viewer", password: TEST_PASSWORD }
const MEMBER = { username: "e2e_ungranted", password: TEST_PASSWORD }
const SEEDED_AGENT = "Website Assistant"

async function logIn(page: Page, account: { password: string; username: string }) {
	await page.goto("/login")
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}

test("manager creates, configures, embeds, and deletes an agent through the real API", async ({ page }) => {
	await logIn(page, OPERATOR)

	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()
	await expect(page.getByRole("link", { name: new RegExp(SEEDED_AGENT) })).toBeVisible()

	await page.getByRole("button", { name: "Create agent" }).click()
	await expect(page).toHaveURL(/\/dashboard\/agent\//)
	await expect(page.getByRole("heading", { name: "Configure New agent" })).toBeVisible()
	await expect(page.getByLabel("Name")).toHaveValue("New agent")

	await page.getByLabel("Name").fill("Docs helper")
	await page.getByLabel("System prompt").fill("You answer questions from the product docs.")
	await page.getByLabel("Word blacklist").fill("spam")
	await page.getByRole("button", { name: "Add" }).click()
	await page.getByLabel("Word blacklist").fill("abuse")
	await page.getByLabel("Word blacklist").press("Enter")
	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	await page.getByRole("button", { name: "Remove abuse" }).click()
	await page.getByRole("button", { name: "Save changes" }).click()
	await page.reload()
	await expect(page.getByRole("heading", { name: "Configure Docs helper" })).toBeVisible()
	await expect(page.getByText("spam", { exact: true })).toBeVisible()
	await expect(page.getByText("abuse", { exact: true })).toHaveCount(0)

	const tokenInput = page.getByLabel("Embed token", { exact: true })
	const firstToken = await tokenInput.inputValue()
	expect(firstToken).toMatch(/^[0-9a-f-]{36}$/)
	await page.getByRole("button", { name: "Refresh token" }).click()
	const refreshDialog = page.getByRole("dialog")
	await expect(refreshDialog.getByText(/stops working/)).toBeVisible()
	await refreshDialog.getByRole("button", { name: "Refresh token" }).click()
	await expect(tokenInput).not.toHaveValue(firstToken)

	await page.getByRole("link", { name: "Analytics", exact: true }).click()
	await page.getByRole("combobox", { name: "Select an agent" }).click()
	await page.getByRole("option", { name: "Docs helper" }).click()
	await expect(page.getByText("Conversations (30 days)")).toBeVisible()

	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await page.getByRole("link", { name: /Docs helper/ }).click()
	await page.getByRole("button", { name: "Delete agent" }).click()
	const deleteDialog = page.getByRole("dialog")
	await expect(deleteDialog.getByRole("button", { name: "Delete permanently" })).toBeDisabled()
	await deleteDialog.getByPlaceholder("Docs helper").fill("Docs helper")
	const confirmButton = deleteDialog.getByRole("button", { name: "Delete permanently" })
	await expect(confirmButton).toBeEnabled()
	await confirmButton.click()
	await expect(page).toHaveURL("/dashboard/agents")
	await expect(page.getByRole("link", { name: /Docs helper/ })).toHaveCount(0)
	await page.reload()
	await expect(page.getByRole("link", { name: /Docs helper/ })).toHaveCount(0)
	await expect(page.getByRole("link", { name: new RegExp(SEEDED_AGENT) })).toBeVisible()
})

test("a read-only operator can inspect agents but finds no management controls", async ({ page }) => {
	await logIn(page, VIEWER)

	await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()
	await expect(page.getByRole("link", { name: "Analytics", exact: true })).toBeVisible()
	await expect(page.getByRole("link", { name: "Invitations", exact: true })).toHaveCount(0)

	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await expect(page.getByRole("button", { name: "Create agent" })).toHaveCount(0)
	await page.getByRole("link", { name: new RegExp(SEEDED_AGENT) }).click()

	await expect(page.getByRole("heading", { name: `Configure ${SEEDED_AGENT}` })).toBeVisible()
	await expect(page.getByLabel("Name")).toBeDisabled()
	await expect(page.getByLabel("System prompt")).toBeDisabled()
	await expect(page.getByText("Intercom", { exact: true })).toBeVisible()
	await expect(page.getByLabel("Embed token", { exact: true })).toBeVisible()
	await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
	await expect(page.getByRole("button", { name: "Refresh token" })).toHaveCount(0)
	await expect(page.getByText("Danger zone")).toHaveCount(0)

	// Widgets ride on the same permission, so their controls must disappear too.
	await page.getByRole("tab", { name: "Widgets" }).click()
	await expect(page.getByRole("button", { name: "New widget" })).toHaveCount(0)
	await page.locator("[data-slot=card]", { hasText: "Marketing site" }).click()

	await expect(page.getByLabel("Name")).toBeDisabled()
	await expect(page.getByLabel("Brand color hex value", { exact: true })).toBeDisabled()
	await expect(page.locator("pre")).toBeVisible()
	await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
})

test("an ungranted operator sees neither agent navigation nor agent content", async ({ page }) => {
	await logIn(page, MEMBER)

	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Analytics", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Invitations", exact: true })).toHaveCount(0)

	await page.goto("/dashboard/agents")
	await expect(page.getByText("Access restricted")).toBeVisible()
})

test("switching accounts does not reuse cached agent permissions", async ({ page }) => {
	await logIn(page, OPERATOR)
	await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()

	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")

	let releasePermissions: (() => void) | undefined
	const permissionsReleased = new Promise<void>((resolve) => {
		releasePermissions = resolve
	})
	await page.route("**/api/me/permissions", async (route) => {
		await permissionsReleased
		await route.continue()
	})

	await page.getByLabel("Username").fill(MEMBER.username)
	await page.getByLabel("Password", { exact: true }).fill(MEMBER.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)

	releasePermissions?.()
})

test("account deletion stays disabled until the account deletion API exists", async ({ page }) => {
	await logIn(page, OPERATOR)
	await page.goto("/dashboard/account")
	await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
	await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(1)
	await expect(page.getByRole("button", { name: "Delete account" })).toBeDisabled()
})
