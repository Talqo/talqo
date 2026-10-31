import { expect } from "@playwright/test"

import { test } from "./chat-embed"
import { web, widget } from "./i18n"
import { openDashboard } from "./log-in"

const WEBSITE_ASSISTANT_ID = "11111111-1111-4111-8111-111111111111"

test("a recorded chat appears in the dashboard statistics after login", async ({ page, chatEmbed }) => {
	const { agentName, widgetUrl } = chatEmbed

	// Chat through the real widget; the fake provider answers immediately.
	await page.goto(widgetUrl)
	await page.getByRole("button", { name: widget("openChat") }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("textbox", { name: widget("messageLabel") }).fill("Record this turn")
	await dialog.getByRole("button", { name: widget("send") }).click()
	await expect(dialog.getByText("Recorded answer.", { exact: true })).toBeVisible()
	await expect(dialog.getByRole("button", { name: widget("stopGenerating") })).toHaveCount(0)

	// Log in through the real web app; the landing page must show the recorded statistics.
	await openDashboard(page)
	const agentRow = page.getByRole("row", { name: new RegExp(`^${agentName}`) })
	await expect(agentRow.getByRole("rowheader")).toHaveText(agentName)
	await expect(agentRow.getByRole("cell").nth(0)).toHaveText("1")
	await expect(agentRow.getByRole("cell").nth(1)).toHaveText("2")
	await expect(agentRow.getByRole("cell").nth(2)).toHaveText("18")

	const lastUpdated = page.getByText(web("dashboard.lastUpdated")).locator("time")
	await expect(lastUpdated).toHaveText(/\d{1,2}:\d{2}/)
	const updatedAtAttribute = await lastUpdated.getAttribute("datetime")
	expect(updatedAtAttribute).not.toBeNull()
	expect(Date.now() - Date.parse(updatedAtAttribute ?? "")).toBeLessThan(60_000)
})

test("the agent filter and time range scope the dashboard and ride in the URL", async ({ page }) => {
	await openDashboard(page)

	const websiteAssistantRow = page.getByRole("row", { name: /^Website Assistant/ })
	await expect(websiteAssistantRow).toBeVisible()

	// Removing an agent from the filter hides it from the per-agent breakdown, and the
	// selection moves into the URL so a filtered dashboard can be shared.
	const agentFilter = page.getByRole("combobox", { name: web("dashboard.agentsLabel"), exact: true })
	await agentFilter.click()
	const websiteOption = page.getByRole("option", { name: "Website Assistant", exact: true })
	await expect(websiteOption).toBeVisible()
	const agentCount = await page.getByRole("option").count()
	await websiteOption.click()
	await page.keyboard.press("Escape")
	await expect(websiteAssistantRow).toHaveCount(0)
	await expect(page).toHaveURL(/[?&]agents=/)

	// The quick action clears the whole selection.
	await agentFilter.click()
	await page.getByRole("button", { name: web("dashboard.deselectAll"), exact: true }).click()
	await page.keyboard.press("Escape")
	await expect(page.getByText(web("dashboard.noAgentsSelected"))).toBeVisible()

	// A shared link opens exactly the filtered view; the other agents stay out.
	await page.goto(`/dashboard?agents=${encodeURIComponent(JSON.stringify([WEBSITE_ASSISTANT_ID]))}`)
	await expect(websiteAssistantRow).toBeVisible()
	await expect(page.getByRole("row", { name: /^Product Advisor/ })).toHaveCount(0)
	await expect(agentFilter).toContainText(
		web("dashboard.agentsSelected", { selected: 1, total: agentCount, count: agentCount }),
	)

	// The time range selector narrows the whole page and rides in the shareable URL alongside
	// the agent selection.
	const rangeFilter = page.getByRole("combobox", { name: web("dashboard.rangeLabel"), exact: true })
	await rangeFilter.click()
	await page.getByRole("option", { name: web("dashboard.range7d"), exact: true }).click()
	await expect(page).toHaveURL((url) => url.searchParams.get("days") === "7" && url.searchParams.has("agents"))
	await page.reload()
	await expect(rangeFilter).toContainText(web("dashboard.range7d"))
	await expect(websiteAssistantRow).toBeVisible()
	await rangeFilter.click()
	await page.getByRole("option", { name: web("dashboard.rangeAll"), exact: true }).click()
	await expect(page).toHaveURL((url) => url.searchParams.get("days") === "all")
	await expect(websiteAssistantRow).toBeVisible()
})
