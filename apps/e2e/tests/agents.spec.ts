import { expect, test, type Page } from "@playwright/test"

// Mirrors the natural seed in apps/api (identity/roles/agent seeds).
const OPERATOR = { username: "user", password: "user1234" }
const VIEWER = { username: "viewer", password: "viewer1234" }
const MEMBER = { username: "member", password: "member1234" }
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

	// The natural seed contributes one agent to start from.
	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()
	await expect(page.getByRole("link", { name: new RegExp(SEEDED_AGENT) })).toBeVisible()

	// One click provisions a blank agent into the configuration page.
	await page.getByRole("button", { name: "Create agent" }).click()
	await expect(page).toHaveURL(/\/dashboard\/agent\//)
	await expect(page.getByRole("heading", { name: "Configure New agent" })).toBeVisible()
	await expect(page.getByLabel("Name")).toHaveValue("New agent")

	// Configure the blank agent in its one and only form, including blacklist chips.
	await page.getByLabel("Name").fill("Docs helper")
	await page.getByLabel("System prompt").fill("You answer questions from the product docs.")
	await page.getByLabel("Word blacklist").fill("spam")
	await page.getByRole("button", { name: "Add" }).click()
	await page.getByLabel("Word blacklist").fill("abuse")
	await page.getByLabel("Word blacklist").press("Enter")
	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	// Remove a chip, save again, and prove persistence across a reload.
	await page.getByRole("button", { name: "Remove abuse" }).click()
	await page.getByRole("button", { name: "Save changes" }).click()
	await page.reload()
	await expect(page.getByRole("heading", { name: "Configure Docs helper" })).toBeVisible()
	await expect(page.getByText("spam", { exact: true })).toBeVisible()
	await expect(page.getByText("abuse", { exact: true })).toHaveCount(0)

	// Refreshing the embed token warns that existing embeds stop working, then rotates it.
	const tokenInput = page.getByLabel("Embed token", { exact: true })
	const firstToken = await tokenInput.inputValue()
	expect(firstToken).toMatch(/^[0-9a-f-]{36}$/)
	await page.getByRole("button", { name: "Refresh token" }).click()
	const refreshDialog = page.getByRole("dialog")
	await expect(refreshDialog.getByText(/stops working/)).toBeVisible()
	await refreshDialog.getByRole("button", { name: "Refresh token" }).click()
	await expect(tokenInput).not.toHaveValue(firstToken)
	const rotatedToken = await tokenInput.inputValue()

	// Widget setup resolves the rotated embed token into the embed snippet.
	await page.getByRole("link", { name: "Widget", exact: true }).click()
	await page.getByLabel("Agent").click()
	await page.getByRole("option", { name: "Docs helper" }).click()
	const widgetCdnUrl = process.env.E2E_WIDGET_CDN_URL
	if (!widgetCdnUrl) throw new Error("E2E_WIDGET_CDN_URL missing — playwright.config.ts provides it")
	const snippet = page.locator("pre")
	await expect(snippet).toContainText(`src="${widgetCdnUrl}"`)
	await expect(snippet).toContainText(`data-talqo-embed-token="${rotatedToken}"`)
	await expect(snippet).not.toContainText("data-talqo-agent")
	await expect(snippet).toContainText('data-talqo-language="en"')
	await expect(snippet).toContainText('data-talqo-position="bottom-right"')
	await page.getByLabel("Position").click()
	await page.getByRole("option", { name: "Bottom left" }).click()
	await expect(snippet).toContainText('data-talqo-position="bottom-left"')
	await expect(page.locator("iframe")).toHaveAttribute("src", /position=bottom-left/)

	// Analytics resolves the same persisted agent.
	await page.getByRole("link", { name: "Analytics", exact: true }).click()
	await page.getByRole("combobox", { name: "Select an agent" }).click()
	await page.getByRole("option", { name: "Docs helper" }).click()
	await expect(page.getByText("Conversations (30 days)")).toBeVisible()

	// Hard delete requires an exact-name confirmation and persists across reloads.
	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await page.getByRole("link", { name: /Docs helper/ }).click()
	await page.getByRole("button", { name: "Delete agent" }).click()
	const deleteDialog = page.getByRole("dialog")
	await expect(deleteDialog.getByRole("button", { name: "Delete permanently" })).toBeDisabled()
	await deleteDialog.getByPlaceholder("Docs helper").fill("Docs helper")
	await deleteDialog.getByRole("button", { name: "Delete permanently" }).click()
	await expect(page).toHaveURL("/dashboard/agents")
	await expect(page.getByRole("link", { name: /Docs helper/ })).toHaveCount(0)
	await page.reload()
	await expect(page.getByRole("link", { name: /Docs helper/ })).toHaveCount(0)
	await expect(page.getByRole("link", { name: new RegExp(SEEDED_AGENT) })).toBeVisible()
})

test("a read-only operator can inspect agents but finds no management controls", async ({ page }) => {
	await logIn(page, VIEWER)

	await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()
	await expect(page.getByRole("link", { name: "Widget", exact: true })).toBeVisible()
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
})

test("an ungranted operator sees neither agent navigation nor agent content", async ({ page }) => {
	await logIn(page, MEMBER)

	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Widget", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Analytics", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Invitations", exact: true })).toHaveCount(0)

	// Direct navigation still shows the access-denied state instead of data.
	await page.goto("/dashboard/agents")
	await expect(page.getByText("Access restricted")).toBeVisible()
})

test("account security controls stay disabled until the account API exists", async ({ page }) => {
	await logIn(page, OPERATOR)
	await page.goto("/dashboard/account")
	await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
	await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(2)
	await expect(page.getByLabel("Current password")).toBeDisabled()
	await expect(page.getByLabel("New password", { exact: true })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Delete account" })).toBeDisabled()
})
