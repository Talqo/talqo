import { expect, test } from "@playwright/test"

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

test("account security controls stay disabled until the account API exists", async ({ page }) => {
	await page.goto("/dashboard/account")
	await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
	await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(2)
	await expect(page.getByLabel("Current password")).toBeDisabled()
	await expect(page.getByLabel("New password", { exact: true })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Delete account" })).toBeDisabled()
})
