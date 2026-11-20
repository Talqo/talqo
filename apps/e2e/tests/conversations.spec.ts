import { expect } from "@playwright/test"

import { test } from "./chat-embed"
import { web, widget } from "./i18n"
import { ADMIN, openDashboard } from "./log-in"

const QUESTION = "Where is my order?"

test("operator finds a visitor conversation from the sidebar and reads it", async ({ page, chatEmbed }) => {
	await page.goto(chatEmbed.widgetUrl)
	await page.getByRole("button", { name: widget("openChat") }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("textbox", { name: widget("messageLabel") }).fill(QUESTION)
	await dialog.getByRole("button", { name: widget("send") }).click()
	await expect(dialog.locator("strong", { hasText: "tomorrow" })).toBeVisible()

	await openDashboard(page, ADMIN, "/dashboard/conversations")
	const row = page.getByRole("link", { name: QUESTION })
	await expect(row).toContainText(chatEmbed.agentName)
	await row.click()

	await expect(page.getByRole("heading", { name: QUESTION, exact: true })).toBeVisible()
	await expect(page.getByRole("list").getByText(QUESTION, { exact: true })).toBeVisible()
	await expect(page.locator("strong", { hasText: "tomorrow" })).toBeVisible()

	await page.getByRole("button", { name: web("conversations.backToConversations") }).click()
	await expect(page).toHaveURL("/dashboard/conversations")
	await expect(page.getByRole("link", { name: QUESTION })).toBeVisible()
})
