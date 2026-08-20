import { expect, test } from "@playwright/test"

async function login(page: import("@playwright/test").Page, username: string) {
	await page.goto("/login")
	await page.getByLabel("Username").fill(username)
	await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_OPERATOR_PASSWORD ?? "")
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}

test("granted operator configures text and embedding models", async ({ page }) => {
	await login(page, process.env.E2E_GRANTED_USERNAME ?? "")
	await page.getByRole("link", { name: "AI configuration" }).click()

	const cards = page.locator("[data-slot=card]")
	const textCard = cards.filter({ has: page.locator("[data-slot=card-title]", { hasText: "Text generation" }) })
	const embeddingCard = cards.filter({ has: page.locator("[data-slot=card-title]", { hasText: "Embeddings" }) })
	await textCard.getByLabel("Provider").click()
	await page.getByRole("option", { name: "OpenAI-compatible" }).click()
	await textCard.getByLabel("Base URL").fill(process.env.E2E_PROVIDER_URL ?? "")
	await textCard.getByLabel("API key").fill("test-key")

	await textCard.getByRole("button", { name: "Show model suggestions" }).click()
	await page.getByRole("option", { name: "chat-model" }).click()
	await expect(textCard.getByLabel("Text model")).toHaveValue("chat-model")

	await embeddingCard.getByRole("button", { name: "Show model suggestions" }).click()
	await page.getByRole("option", { name: "embedding-model" }).click()
	await expect(embeddingCard.getByLabel("Embedding model")).toHaveValue("embedding-model")

	await page.getByRole("button", { name: "Save configuration" }).click()
	await expect(page.getByText("Configuration saved")).toBeVisible()

	await page.reload()
	await expect(textCard.getByLabel("Text model")).toHaveValue("chat-model")
	await expect(textCard.getByLabel("API key")).toHaveAttribute("placeholder", /Configured/)

	await expect(textCard.getByRole("button", { name: "Show model suggestions" })).toBeVisible()
	await textCard.getByRole("button", { name: "Show model suggestions" }).click()
	await expect(page.getByRole("option", { name: "chat-model" })).toBeVisible()
	await page.keyboard.press("Escape")

	await embeddingCard.getByRole("button", { name: "Show model suggestions" }).click()
	await expect(page.getByRole("option", { name: "embedding-model" })).toBeVisible()
	await page.keyboard.press("Escape")

	await expect(page.getByText("The model list could not be loaded")).toHaveCount(0)
})

test("ungranted operator cannot discover or open AI configuration", async ({ page }) => {
	await login(page, process.env.E2E_UNGRANTED_USERNAME ?? "")
	await expect(page.getByRole("link", { name: "AI configuration" })).toHaveCount(0)

	await page.goto("/dashboard/ai-configuration")
	await expect(page).toHaveURL("/dashboard")
	const response = await page.request.get("/api/ai-providers")
	await expect(response).not.toBeOK()
	expect(response.status()).toBe(403)
})
