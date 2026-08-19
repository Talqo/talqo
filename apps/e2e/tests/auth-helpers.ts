import type { Page } from "@playwright/test"

// The app allows exactly one admin ever; auth.setup.ts is the only place that bootstraps it.
export const adminUsername = "e2e_shared_admin"
export const adminPassword = "correct-horse-battery-staple"

export async function loginViaForm(page: Page, username: string, password: string): Promise<void> {
	await page.getByLabel("Username").fill(username)
	await page.getByLabel("Password", { exact: true }).fill(password)
	await page.getByRole("button", { name: "Log in" }).click()
}
