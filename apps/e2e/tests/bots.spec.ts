import { expect, test } from "@playwright/test"

test("bot journey: create, configure, pause, and embed", async ({ page }) => {
	await page.goto("/dashboard/bots")
	await expect(page.getByRole("heading", { name: "Bots" })).toBeVisible()
	await expect(page.getByText("No bots yet.")).toBeVisible()

	// Create a bot through the dialog.
	await page.getByRole("button", { name: "Create bot" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Name").fill("Docs helper")
	await dialog.getByLabel("System prompt").fill("You answer questions from the product docs.")
	await dialog.getByLabel("Word blacklist").fill("spam, abuse")
	await dialog.getByRole("button", { name: "Create bot" }).click()

	// The overview card shows the bot without the blocked-word detail, which
	// stays on the config page.
	const card = page.locator("[data-slot=card]", { hasText: "Docs helper" })
	await expect(card).toBeVisible()
	await expect(card.getByText("spam", { exact: true })).toHaveCount(0)

	// Configure: blacklist chips and edits live here.
	// (Button render={<Link />} keeps button role semantics.)
	await card.getByRole("button", { name: "Configure" }).click()
	await expect(page.getByRole("heading", { name: "Configure Docs helper" })).toBeVisible()
	await expect(page.getByText("spam", { exact: true })).toBeVisible()
	await page.getByLabel("Name").fill("Docs helper 2")
	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	// Pause from the overview.
	await page.getByRole("button", { name: "Back to bots" }).click()
	const updated = page.locator("[data-slot=card]", { hasText: "Docs helper 2" })
	await expect(updated).toBeVisible()
	await updated.getByRole("switch").click()
	await expect(updated.getByRole("switch")).toHaveAttribute("aria-checked", "false")

	// The embed snippet carries the selected bot and appearance settings; it is
	// only rendered once the widget origin is configured (see playwright.config).
	await page.getByRole("link", { name: "Widget", exact: true }).click()
	await page.getByLabel("Bot").click()
	await page.getByRole("option", { name: "Docs helper 2" }).click()
	const snippet = page.locator("pre")
	await expect(snippet).toContainText('src="http://localhost:5174/widget.js"')
	await expect(snippet).toContainText("data-talqo-bot=")
	await expect(snippet).toContainText('data-talqo-language="en"')
	await expect(snippet).toContainText('data-talqo-position="bottom-right"')
})

test("account security controls stay disabled until the account API exists", async ({ page }) => {
	await page.goto("/dashboard/account")
	await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
	await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(2)
	await expect(page.getByLabel("Current password")).toBeDisabled()
	await expect(page.getByLabel("New password", { exact: true })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Delete account" })).toBeDisabled()
})
