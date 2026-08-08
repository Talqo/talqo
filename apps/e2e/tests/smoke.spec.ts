import { expect, test } from "@playwright/test"

test("serves the API and web application", async ({ page, request }) => {
	const healthResponse = await request.get("http://127.0.0.1:3000/health")

	expect(healthResponse.ok()).toBe(true)
	expect(await healthResponse.json()).toEqual({ status: "ok" })

	// / always redirects (to /setup or /login depending on admin state, which other
	// specs in this run may have already changed) -- just prove the app is wired up.
	await page.goto("/")
	await expect(page).toHaveURL(/\/(setup|login)$/)
})
