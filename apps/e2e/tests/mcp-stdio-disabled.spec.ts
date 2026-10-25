import { expect } from "@playwright/test"

import { test } from "./application"
import { openDashboard } from "./log-in"

test.use({ stdioAllowed: false })

test("disabled command connections stay visible but cannot be added or enabled", async ({ page }) => {
	await openDashboard(page)
	// The seeded connection represents a command configured before the host disabled stdio.
	await page.goto("/dashboard/agent/11111111-1111-4111-8111-111111111111?tab=mcp")
	const legacy = page.getByTestId("mcp-server-card").filter({ hasText: "Shop inventory" })
	await expect(legacy.getByText(/Command-based connections are disabled/)).toBeVisible()
	await expect(legacy.getByRole("switch", { name: "Connection enabled", exact: true })).toBeDisabled()
	await expect(legacy.getByRole("button", { name: "Remove", exact: true })).toBeEnabled()
	await legacy.getByRole("button", { name: "Edit", exact: true }).click()
	const dialog = page.getByRole("dialog")
	await expect(dialog.getByRole("button", { name: "Save changes" })).toBeDisabled()
	await dialog.getByRole("combobox", { name: "Type" }).click()
	await page.getByRole("option", { name: "http", exact: true }).click()
	await expect(dialog.getByRole("button", { name: "Save changes" })).toBeEnabled()
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
	await page.getByRole("button", { name: "Add connection", exact: true }).click()
	await dialog.getByRole("combobox", { name: "Type" }).click()
	await expect(page.getByRole("option", { name: "stdio", exact: true })).toHaveCount(0)
	await expect(page.getByRole("option", { name: "http", exact: true })).toBeVisible()
})
