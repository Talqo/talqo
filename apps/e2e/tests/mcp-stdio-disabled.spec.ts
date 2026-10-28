import { expect } from "@playwright/test"

import { test } from "./application"
import { web } from "./i18n"
import { openDashboard } from "./log-in"

test.use({ stdioAllowed: false })

test("disabled command connections stay visible but cannot be added or enabled", async ({ page }) => {
	await openDashboard(page)
	// The seeded connection represents a command configured before the host disabled stdio.
	await page.goto("/dashboard/agent/11111111-1111-4111-8111-111111111111?tab=mcp")
	const legacy = page.getByTestId("mcp-server-card").filter({ hasText: "Shop inventory" })
	await expect(legacy.getByText(web("mcp.stdioDisabled"))).toBeVisible()
	await expect(legacy.getByRole("switch", { name: web("mcp.enabled"), exact: true })).toBeDisabled()
	await expect(legacy.getByRole("switch", { name: web("mcp.enabled"), exact: true })).toBeChecked()
	await expect(legacy.getByRole("button", { name: web("mcp.remove"), exact: true })).toBeEnabled()
	await legacy.getByRole("button", { name: web("mcp.edit"), exact: true }).click()
	const dialog = page.getByRole("dialog")
	await expect(dialog.getByRole("button", { name: web("mcp.save") })).toBeDisabled()
	await dialog.getByRole("combobox", { name: web("mcp.kind") }).click()
	await page.getByRole("option", { name: web("mcp.transportHttp"), exact: true }).click()
	await expect(dialog.getByRole("button", { name: web("mcp.save") })).toBeEnabled()
	await dialog.getByRole("button", { name: web("common.cancel"), exact: true }).click()
	await page.getByRole("button", { name: web("mcp.add"), exact: true }).click()
	await dialog.getByRole("combobox", { name: web("mcp.kind") }).click()
	await expect(page.getByRole("option", { name: web("mcp.transportStdio"), exact: true })).toHaveCount(0)
	await expect(page.getByRole("option", { name: web("mcp.transportHttp"), exact: true })).toBeVisible()
})
