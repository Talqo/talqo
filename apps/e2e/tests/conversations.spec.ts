import { expect } from "@playwright/test"

import { test } from "./application"
import { openDashboard } from "./log-in"

const OPERATOR = { username: "admin", password: "admin123" }
const QUESTION = "Where is my order?"

let fixture: { agentId: string; embedId?: string } | undefined

test.afterEach(async ({ page }) => {
	if (!fixture) return
	const { agentId, embedId } = fixture
	fixture = undefined
	const embedDeleted = embedId ? await page.request.delete(`/api/embeds/${embedId}`) : undefined
	await expect(await page.request.delete(`/api/agents/${agentId}`)).toBeOK()
	if (embedDeleted) await expect(embedDeleted).toBeOK()
})

test("operator finds a visitor conversation from the sidebar and reads it", async ({ page }, testInfo) => {
	const agentName = `Conversations ${testInfo.project.name} ${testInfo.retry}`
	await expect(await page.request.post("/api/auth/login", { data: OPERATOR })).toBeOK()
	const agentResponse = await page.request.post("/api/agents", {
		data: {
			name: agentName,
			systemPrompt: "You are the support assistant on our company website.",
			wordBlacklist: [],
		},
	})
	await expect(agentResponse).toBeOK()
	const { agent } = (await agentResponse.json()) as { agent: { id: string } }
	fixture = { agentId: agent.id }
	const { embeds } = (await (await page.request.get("/api/embeds")).json()) as { embeds: { appearance: unknown }[] }
	const embedResponse = await page.request.post("/api/embeds", {
		data: { agentId: agent.id, name: "Conversations test", appearance: embeds[0]?.appearance },
	})
	await expect(embedResponse).toBeOK()
	const { embed } = (await embedResponse.json()) as { embed: { embedToken: string; id: string } }
	fixture.embedId = embed.id

	const chat = await page.request.post(`/api/chat/${embed.embedToken}/messages`, {
		headers: { Authorization: `Bearer ${crypto.randomUUID()}` },
		data: { requestId: crypto.randomUUID(), text: QUESTION },
	})
	await expect(chat).toBeOK()
	expect(await chat.text()).toContain('"outcome":"completed"')

	await openDashboard(page, OPERATOR, "/dashboard/conversations")
	const row = page.getByRole("link", { name: QUESTION })
	await expect(row).toContainText(agentName)
	await row.click()

	await expect(page.getByRole("heading", { name: "Conversation", exact: true })).toBeVisible()
	await expect(page.getByText(QUESTION, { exact: true })).toBeVisible()
	await expect(page.locator("strong", { hasText: "tomorrow" })).toBeVisible()

	await page.getByRole("button", { name: "Back to conversations" }).click()
	await expect(page).toHaveURL("/dashboard/conversations")
	await expect(page.getByRole("link", { name: QUESTION })).toBeVisible()
})
