import { expect, test, type Page } from "@playwright/test"

const OPERATOR = { username: "admin", password: "admin123" }
const QUESTION = "Where is my order?"

let fixture: { agentId: string; embedId?: string } | undefined

async function logIn(page: Page) {
	await page.goto("/login")
	await page.getByLabel("Username").fill(OPERATOR.username)
	await page.getByLabel("Password", { exact: true }).fill(OPERATOR.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}

test.afterEach(async ({ page }) => {
	if (!fixture) return
	if (fixture.embedId) await expect(await page.request.delete(`/api/embeds/${fixture.embedId}`)).toBeOK()
	await expect(await page.request.delete(`/api/agents/${fixture.agentId}`)).toBeOK()
	fixture = undefined
})

test("operator reads a visitor conversation from the agent page", async ({ page }, testInfo) => {
	await expect(await page.request.post("/api/auth/login", { data: OPERATOR })).toBeOK()
	const agentResponse = await page.request.post("/api/agents", {
		data: {
			name: `Conversations ${testInfo.project.name} ${testInfo.retry}`,
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

	// The visitor side is covered by embed.spec.ts; here a chat only needs to exist.
	const chat = await page.request.post(`/api/chat/${embed.embedToken}/messages`, {
		headers: { Authorization: `Bearer ${crypto.randomUUID()}` },
		data: { requestId: crypto.randomUUID(), text: QUESTION },
	})
	await expect(chat).toBeOK()
	expect(await chat.text()).toContain('"outcome":"completed"')

	await logIn(page)
	await page.goto(`/dashboard/agent/${agent.id}?tab=conversations`)
	await page.getByRole("link", { name: QUESTION }).click()

	await expect(page.getByRole("heading", { name: "Conversation" })).toBeVisible()
	await expect(page.getByText(QUESTION, { exact: true })).toBeVisible()
	await expect(page.locator("strong", { hasText: "tomorrow" })).toBeVisible()

	await page.getByRole("button", { name: "Back to conversations" }).click()
	await expect(page).toHaveURL(new RegExp(`/dashboard/agent/${agent.id}\\?tab=conversations`))
})
