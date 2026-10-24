import { expect, type Page } from "@playwright/test"

export const ADMIN = { username: "admin", password: "admin123" }
export const MEMBER = { username: "user", password: "user1234" }

export async function openDashboard(page: Page, account = ADMIN): Promise<void> {
	await expect(await page.request.post("/api/auth/login", { data: account })).toBeOK()
	await page.goto("/dashboard")
	await expect(page).toHaveURL("/dashboard")
}

export async function logIn(page: Page, account = ADMIN): Promise<void> {
	await page.goto("/login")
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}
