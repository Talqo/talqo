import { expect } from "@playwright/test"

import { test } from "./application"
import { web } from "./i18n"
import { ADMIN, openDashboard } from "./log-in"

test.use({ viewport: { width: 320, height: 720 } })

test("mobile navigation focuses the panel, closes on Escape, and restores the toggle", async ({ page }) => {
	await openDashboard(page, ADMIN, "/dashboard")
	const toggle = page.getByRole("button", { name: web("header.toggleNavigation") })

	await toggle.click()
	const panel = page.locator("#mobile-navigation")
	await expect(panel).toBeVisible()
	await expect(toggle).toHaveAttribute("aria-expanded", "true")
	await expect(panel.locator("nav a").first()).toBeFocused()

	await page.keyboard.press("Escape")

	await expect(panel).toBeHidden()
	await expect(toggle).toHaveAttribute("aria-expanded", "false")
	await expect(toggle).toBeFocused()
})

test("agent tabs scroll inside their strip instead of widening the page", async ({ page, agent }) => {
	await openDashboard(page, ADMIN, `/dashboard/agent/${agent.id}`)

	const strip = page.getByRole("tablist")
	await expect(strip).toBeVisible()
	await expect(page.getByRole("tab", { name: web("agentConfig.tabConfiguration") })).toBeVisible()

	const { clientWidth, scrollWidth } = await page.evaluate(() => ({
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
	}))
	expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
	expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
})
