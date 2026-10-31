import { expect } from "@playwright/test"

import { test } from "./application"
import { web } from "./i18n"
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
	const textCard = cards.filter({
		has: page.locator("[data-slot=card-title]", { hasText: web("aiConfiguration.textTitle") }),
	})
	const embeddingCard = cards.filter({
		has: page.locator("[data-slot=card-title]", { hasText: web("aiConfiguration.embeddingTitle") }),
	})
	await expect(textCard.getByLabel(web("aiConfiguration.fields.provider"))).toContainText(
		web("aiConfiguration.providers.openaiCompatible"),
	)
	await expect(textCard.getByLabel(web("aiConfiguration.fields.baseURL"))).toHaveValue(
		`${application.providerOrigin}/v1`,
	)
	await expect(textCard.getByLabel(web("aiConfiguration.fields.textModel"))).toHaveValue("chat-model")
	await expect(embeddingCard.getByLabel(web("aiConfiguration.fields.embeddingModel"))).toHaveValue("embedding-model")
	await textCard.getByRole("button", { name: web("aiConfiguration.replaceCredentials"), exact: true }).click()
	await textCard.getByLabel(web("aiConfiguration.fields.apiKey")).fill("test-key")

	await textCard.getByRole("button", { name: web("aiConfiguration.discovery.showModels") }).click()
	await page.getByRole("option", { name: "chat-model-next", exact: true }).click()

	await embeddingCard.getByRole("button", { name: web("aiConfiguration.discovery.showModels") }).click()
	await page.getByRole("option", { name: "embedding-model", exact: true }).click()
	await expect(embeddingCard.getByLabel(web("aiConfiguration.fields.embeddingModel"))).toHaveValue("embedding-model")

	await page.getByRole("button", { name: web("aiConfiguration.save") }).click()
	await expect(page.getByText(web("aiConfiguration.saved"))).toBeVisible()

	await page.reload()
	await expect(textCard.getByLabel(web("aiConfiguration.fields.textModel"))).toHaveValue("chat-model-next")
	await expect(textCard.getByLabel(web("aiConfiguration.fields.baseURL"))).toHaveValue(
		`${application.providerOrigin}/v1`,
	)
	await expect(embeddingCard.getByLabel(web("aiConfiguration.fields.embeddingModel"))).toHaveValue("embedding-model")
	await expect(
		textCard.getByRole("button", { name: web("aiConfiguration.replaceCredentials"), exact: true }),
	).toBeVisible()
	await expect(textCard.getByLabel(web("aiConfiguration.fields.apiKey"))).toHaveCount(0)

	await expect(textCard.getByRole("button", { name: web("aiConfiguration.discovery.showModels") })).toBeVisible()
	await textCard.getByRole("button", { name: web("aiConfiguration.discovery.showModels") }).click()
	await expect(page.getByRole("option", { name: "chat-model-next", exact: true })).toBeVisible()
	await page.keyboard.press("Escape")

	await embeddingCard.getByRole("button", { name: web("aiConfiguration.discovery.showModels") }).click()
	await expect(page.getByRole("option", { name: "embedding-model", exact: true })).toBeVisible()
	await page.keyboard.press("Escape")

	await expect(page.getByText(web("aiConfiguration.discovery.unavailable"))).toHaveCount(0)
})

test("embedding model changes require confirmation and survive reload", async ({ page }) => {
	await openDashboard(page, ADMIN, "/dashboard/ai-configuration")
	const embeddingCard = page
		.locator("[data-slot=card]")
		.filter({ has: page.getByText(web("aiConfiguration.embeddingTitle"), { exact: true }) })
	await embeddingCard.getByRole("button", { name: web("aiConfiguration.discovery.showModels") }).click()
	await page.getByRole("option", { name: "embedding-model-next" }).click()
	await page.getByRole("button", { name: web("aiConfiguration.save") }).click()
	const confirmation = page.getByRole("dialog", { name: web("aiConfiguration.reembedTitle") })
	await expect(confirmation).toContainText(web("aiConfiguration.reembedWarning"))
	await confirmation.getByRole("button", { name: web("common.cancel") }).click()
	await expect(page.getByLabel(web("aiConfiguration.fields.embeddingModel"))).toHaveValue("embedding-model-next")
	await page.reload()
	await expect(page.getByLabel(web("aiConfiguration.fields.embeddingModel"))).toHaveValue("embedding-model")
	await embeddingCard.getByRole("button", { name: web("aiConfiguration.discovery.showModels") }).click()
	await page.getByRole("option", { name: "embedding-model-next", exact: true }).click()
	await page.getByRole("button", { name: web("aiConfiguration.save") }).click()
	await confirmation.getByRole("button", { name: web("aiConfiguration.reembedConfirm") }).click()
	await expect(page.getByText(web("aiConfiguration.saved"))).toBeVisible()
	await page.reload()
	await expect(page.getByLabel(web("aiConfiguration.fields.embeddingModel"))).toHaveValue("embedding-model-next")
})
