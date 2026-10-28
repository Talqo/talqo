import { expect } from "@playwright/test"

import { test } from "./application"
import { ADMIN, openDashboard } from "./log-in"

test.afterEach(async ({ adminRequest: request, application }) => {
	const response = await request.get("/api/ai-provider-configuration")
	await expect(response).toBeOK()
	const current = (await response.json()) as { revision: number }
	await expect(
		await request.put("/api/ai-provider-configuration", {
			data: {
				expectedRevision: current.revision,
				text: {
					providerId: "openai-compatible",
					modelId: "chat-model",
					authMode: "static",
					settings: { baseURL: `${application.providerOrigin}/v1` },
					credentials: { apiKey: "e2e-provider-key" },
				},
				embedding: {
					providerId: "openai-compatible",
					modelId: "embedding-model",
					authMode: "static",
					settings: { baseURL: `${application.providerOrigin}/v1` },
					credentialSource: "text",
				},
			},
		}),
	).toBeOK()
})

test("granted operator configures text and embedding models", async ({ page, application }) => {
	await openDashboard(page, ADMIN, "/dashboard/ai-configuration")

	const cards = page.locator("[data-slot=card]")
	const textCard = cards.filter({ has: page.locator("[data-slot=card-title]", { hasText: "Text generation" }) })
	const embeddingCard = cards.filter({ has: page.locator("[data-slot=card-title]", { hasText: "Embeddings" }) })
	await expect(textCard.getByLabel("Provider")).toContainText("OpenAI-compatible")
	await expect(textCard.getByLabel("Base URL")).toHaveValue(`${application.providerOrigin}/v1`)
	await expect(textCard.getByLabel("Text model")).toHaveValue("chat-model")
	await expect(embeddingCard.getByLabel("Embedding model")).toHaveValue("embedding-model")
	await textCard.getByRole("button", { name: "Replace", exact: true }).click()
	await textCard.getByLabel("API key").fill("test-key")

	await textCard.getByRole("button", { name: "Show model suggestions" }).click()
	await page.getByRole("option", { name: "chat-model-next", exact: true }).click()

	await embeddingCard.getByRole("button", { name: "Show model suggestions" }).click()
	await page.getByRole("option", { name: "embedding-model", exact: true }).click()
	await expect(embeddingCard.getByLabel("Embedding model")).toHaveValue("embedding-model")

	await page.getByRole("button", { name: "Save configuration" }).click()
	await expect(page.getByText("Configuration saved")).toBeVisible()

	await page.reload()
	await expect(textCard.getByLabel("Text model")).toHaveValue("chat-model-next")
	await expect(textCard.getByLabel("Base URL")).toHaveValue(`${application.providerOrigin}/v1`)
	await expect(embeddingCard.getByLabel("Embedding model")).toHaveValue("embedding-model")
	await expect(textCard.getByRole("button", { name: "Replace", exact: true })).toBeVisible()
	await expect(textCard.getByLabel("API key")).toHaveCount(0)

	await expect(textCard.getByRole("button", { name: "Show model suggestions" })).toBeVisible()
	await textCard.getByRole("button", { name: "Show model suggestions" }).click()
	await expect(page.getByRole("option", { name: "chat-model-next", exact: true })).toBeVisible()
	await page.keyboard.press("Escape")

	await embeddingCard.getByRole("button", { name: "Show model suggestions" }).click()
	await expect(page.getByRole("option", { name: "embedding-model", exact: true })).toBeVisible()
	await page.keyboard.press("Escape")

	await expect(page.getByText("The model list could not be loaded")).toHaveCount(0)
})

test("embedding model changes require confirmation and survive reload", async ({ page }) => {
	await openDashboard(page, ADMIN, "/dashboard/ai-configuration")
	const embeddingCard = page.locator("[data-slot=card]").filter({ has: page.getByText("Embeddings", { exact: true }) })
	await embeddingCard.getByRole("button", { name: "Show model suggestions" }).click()
	await page.getByRole("option", { name: "embedding-model-next" }).click()
	await page.getByRole("button", { name: "Save configuration" }).click()
	const confirmation = page.getByRole("dialog", { name: "Re-embed knowledge files?" })
	await expect(confirmation).toContainText("one at a time")
	await expect(confirmation).toContainText("provider charges")
	await confirmation.getByRole("button", { name: "Cancel" }).click()
	await expect(page.getByLabel("Embedding model")).toHaveValue("embedding-model-next")
	await page.reload()
	await expect(page.getByLabel("Embedding model")).toHaveValue("embedding-model")
	await embeddingCard.getByRole("button", { name: "Show model suggestions" }).click()
	await page.getByRole("option", { name: "embedding-model-next", exact: true }).click()
	await page.getByRole("button", { name: "Save configuration" }).click()
	await confirmation.getByRole("button", { name: "Save and re-embed" }).click()
	await expect(page.getByText("Configuration saved")).toBeVisible()
	await page.reload()
	await expect(page.getByLabel("Embedding model")).toHaveValue("embedding-model-next")
})
