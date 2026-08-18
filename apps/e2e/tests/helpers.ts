import { expect, type Page } from "@playwright/test"

// Shared admin for the serial suite: auth-flow.spec.ts (alphabetically first of the
// dashboard-related specs) bootstraps this account; later specs reuse it. Do not give
// other specs their own bootstrap — only one admin can ever exist.
export const E2E_ADMIN = { password: "correct-horse-battery-staple", username: "e2e_admin" }

export async function loginAsAdmin(page: Page): Promise<void> {
	await page.goto("/login")
	await page.getByLabel("Username").fill(E2E_ADMIN.username)
	await page.getByLabel("Password", { exact: true }).fill(E2E_ADMIN.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL(/\/dashboard$/)
}
