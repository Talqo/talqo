import { expect, type Page } from "@playwright/test"

export const ADMIN = { username: "admin", password: "admin123" }
export const MEMBER = { username: "user", password: "user1234" }

export async function logInThroughApi(page: Page, account = ADMIN): Promise<void> {
	await expect(await page.request.post("/api/auth/login", { data: account })).toBeOK()
}

export async function openDashboard(page: Page, account = ADMIN, path = "/dashboard"): Promise<void> {
	await logInThroughApi(page, account)
	await page.goto(path)
	await expect(page).toHaveURL(path)
}

export async function logOut(page: Page): Promise<void> {
	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
}

export async function logIn(page: Page, account = ADMIN): Promise<void> {
	if (new URL(page.url()).pathname !== "/login") await page.goto("/login")
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL(/\/dashboard(?:\/[^?]*)?(?:\?.*)?$/)
}
