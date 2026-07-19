import { expect, test } from "@playwright/test"

test("serves the API and web application", async ({ page, request }) => {
	const healthResponse = await request.get("http://127.0.0.1:3000/health")

	expect(healthResponse.ok()).toBe(true)
	expect(await healthResponse.json()).toEqual({ status: "ok" })

	await page.goto("/")
	await expect(page.getByRole("heading", { name: "Talqo" })).toBeVisible()
})
