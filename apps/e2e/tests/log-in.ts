import { expect, type Page } from "@playwright/test"

export async function logIn(page: Page, account: { password: string; username: string }): Promise<void> {
	await page.goto("/login")
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}
