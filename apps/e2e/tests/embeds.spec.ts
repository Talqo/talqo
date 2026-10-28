import { expect, type Page } from "@playwright/test"

import { test } from "./application"
import { logInThroughApi } from "./log-in"
import { WIDGET_APPEARANCE } from "./widget-appearance"

test.beforeEach(async ({ page }) => {
	await logInThroughApi(page)
})

async function createEmbed(page: Page, agentId: string) {
	const response = await page.request.post("/api/embeds", {
		data: { name: "Journey embed", agentId, appearance: WIDGET_APPEARANCE },
	})
	await expect(response).toBeOK()
	const { embed } = (await response.json()) as { embed: { id: string; embedToken: string } }
	return embed
}

test("embed configuration waits for agent permissions before showing editable controls", async ({ page, agent }) => {
	const embed = await createEmbed(page, agent.id)
	const release = Promise.withResolvers<void>()
	await page.route("**/api/agents", async (route) => {
		await release.promise
		await route.continue()
	})
	try {
		const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/embeds/${embed.id}`)
		await page.goto(`/dashboard/embeds/${embed.id}`)
		await loaded
		await expect(page.locator("main").getByText("Loading…", { exact: true })).toBeVisible()
		await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0)
		release.resolve()
		await expect(page.getByLabel("Name", { exact: true })).toBeEnabled()
	} finally {
		release.resolve()
		await page.unroute("**/api/agents")
	}
})

test("operator creates, names, and permanently deletes an embed", async ({ page, agent }) => {
	const agentId = agent.id
	await page.goto(`/dashboard/agent/${agentId}?tab=embeds`)
	const responsePromise = page.waitForResponse(
		(response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/embeds",
	)
	await page.getByRole("button", { name: "New embed" }).click()
	const created = await responsePromise
	expect(created.ok()).toBe(true)
	const { embed } = (await created.json()) as { embed: { id: string } }
	await expect(page).toHaveURL(`/dashboard/embeds/${embed.id}`)

	await page.getByLabel("Name", { exact: true }).fill("Customer help")
	const saved = page.waitForResponse(
		(response) =>
			response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/embeds/${embed.id}`,
	)
	await page.getByRole("button", { name: "Save changes" }).click()
	expect((await saved).ok()).toBe(true)
	await page.reload()
	await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Customer help")
	const preview = page.frameLocator("iframe")
	await page.locator("iframe").scrollIntoViewIfNeeded()
	await preview.getByRole("button", { name: "Open chat" }).click()
	await expect(preview.getByRole("dialog").getByRole("heading")).toHaveText("Customer help")

	await page.getByRole("button", { name: "Delete embed" }).click()
	const dialog = page.getByRole("dialog", { name: "Delete embed?" })
	const confirm = dialog.getByRole("button", { name: "Delete permanently" })
	await expect(confirm).toBeDisabled()
	await dialog.getByPlaceholder("Customer help").fill("Customer help typo")
	await expect(confirm).toBeDisabled()
	await dialog.getByPlaceholder("Customer help").fill("Customer help")
	await confirm.click()
	await expect(page).toHaveURL(`/dashboard/agent/${agentId}?tab=embeds`)
	await page.reload()
	await expect(page.getByRole("link", { name: "Customer help", exact: true })).toHaveCount(0)
	expect((await page.request.get(`/api/embeds/${embed.id}`)).status()).toBe(404)
})

test("operator previews and saves independent light and dark palettes", async ({ page, agent }) => {
	const embed = await createEmbed(page, agent.id)
	await page.goto(`/dashboard/embeds/${embed.id}`)
	const launcher = page.frameLocator("iframe").getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	let previewNavigations = 0
	page.on("framenavigated", (frame) => {
		if (frame.parentFrame()) previewNavigations += 1
	})

	await page.getByRole("tab", { name: "Light", exact: true }).click()
	await page
		.getByRole("tabpanel", { name: "Light", exact: true })
		.getByLabel("Brand color hex value", { exact: true })
		.fill("#b91c1c")
	await expect(launcher).toHaveCSS("background-color", "rgb(185, 28, 28)")
	await page.getByRole("tab", { name: "Dark", exact: true }).click()
	await page
		.getByRole("tabpanel", { name: "Dark", exact: true })
		.getByLabel("Brand color hex value", { exact: true })
		.fill("#0ea5e9")
	await expect(launcher).toHaveCSS("background-color", "rgb(14, 165, 233)")
	await page.getByRole("tab", { name: "Light", exact: true }).click()
	await expect(launcher).toHaveCSS("background-color", "rgb(185, 28, 28)")
	expect(previewNavigations).toBe(0)
	const saved = page.waitForResponse(
		(response) =>
			response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/embeds/${embed.id}`,
	)
	await page.getByRole("button", { name: "Save changes" }).click()
	expect((await saved).ok()).toBe(true)
	await page.reload()
	await expect(launcher).toHaveCSS("background-color", "rgb(185, 28, 28)")
	await page.getByRole("tab", { name: "Dark", exact: true }).click()
	await expect(launcher).toHaveCSS("background-color", "rgb(14, 165, 233)")
})

test("operator disables and re-enables an installed embed", async ({ page, agent }) => {
	const agentId = agent.id
	const embed = await createEmbed(page, agent.id)
	await page.goto(`/dashboard/agent/${agentId}?tab=embeds`)
	const card = page
		.locator("[data-slot=card]")
		.filter({ has: page.getByRole("link", { name: "Journey embed", exact: true }) })
	const toggle = card.getByRole("switch", { name: "Embed enabled" })
	await expect(toggle).toBeChecked()
	await toggle.click()
	await expect(toggle).not.toBeChecked()
	await expect(page).toHaveURL(`/dashboard/agent/${agentId}?tab=embeds`)
	await page.reload()
	await expect(toggle).not.toBeChecked()
	await expect
		.poll(async () => {
			const response = await page.request.get(`/api/embed-config/${embed.embedToken}`)
			return ((await response.json()) as { isAvailable: boolean }).isAvailable
		})
		.toBe(false)

	// Disabling hides the public chat but keeps appearance previews usable.
	await page.goto(`/dashboard/embeds/${embed.id}`)
	await expect(page.frameLocator("iframe").getByRole("button", { name: "Open chat" })).toBeVisible()
	await page.goto(`/embed-preview?embed=${embed.id}`)
	await expect(page.frameLocator("iframe").getByRole("button", { name: "Open chat" })).toBeVisible()
	await page.goto(`/dashboard/agent/${agentId}?tab=embeds`)

	await expect(toggle).not.toBeChecked()
	await toggle.click()
	await expect(toggle).toBeChecked()
	await page.reload()
	await expect(toggle).toBeChecked()
	await expect
		.poll(async () => {
			const response = await page.request.get(`/api/embed-config/${embed.embedToken}`)
			return ((await response.json()) as { isAvailable: boolean }).isAvailable
		})
		.toBe(true)
	await card.click({ position: { x: 10, y: 10 } })
	await expect(page).toHaveURL(`/dashboard/embeds/${embed.id}`)
})

test("operator rotates an embed token and receives a working replacement snippet", async ({ page, agent }) => {
	const embed = await createEmbed(page, agent.id)
	await page.goto(`/dashboard/embeds/${embed.id}`)
	const tokenInput = page.getByLabel("Embed token", { exact: true })
	await expect(tokenInput).toHaveValue(embed.embedToken)
	await page.getByRole("button", { name: "Rotate token" }).click()
	const dialog = page.getByRole("dialog", { name: "Rotate the embed token?" })
	await dialog.getByRole("button", { name: "Rotate token" }).click()
	await expect(dialog).toBeHidden()
	await expect(tokenInput).not.toHaveValue(embed.embedToken)
	const rotated = await tokenInput.inputValue()
	await page.reload()
	await expect(tokenInput).toHaveValue(rotated)
	const snippet = page.locator("pre")
	await expect(snippet).not.toContainText(embed.embedToken)
	await expect(snippet).toContainText(`data-talqo-embed-token="${rotated}"`)
	await expect(snippet).toContainText("<script async")
	expect((await page.request.get(`/api/embed-config/${embed.embedToken}`)).status()).toBe(404)
	await expect(await page.request.get(`/api/embed-config/${rotated}`)).toBeOK()
})
