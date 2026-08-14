import { expect, test } from "@playwright/test"

test("serves the API and web application", async ({ page, request }) => {
	const apiPort = process.env.TALQO_API_PORT
	if (!apiPort) throw new Error("TALQO_API_PORT missing; the E2E runner provides it")
	const healthResponse = await request.get(`http://127.0.0.1:${apiPort}/health`)

	expect(healthResponse.ok()).toBe(true)
	expect(await healthResponse.json()).toEqual({ status: "ok" })

	// / always redirects (to /setup or /login depending on admin state, which other
	// specs in this run may have already changed) -- just prove the app is wired up.
	await page.goto("/")
	await expect(page).toHaveURL(/\/(setup|login)$/)
})
