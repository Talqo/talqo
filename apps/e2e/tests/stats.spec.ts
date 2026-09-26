import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import path from "node:path"

const DIST = path.resolve(import.meta.dirname, "../../widget/dist")
const HOST_HTML_PATH = path.resolve(import.meta.dirname, "fixtures/host.html")

let server: Server
let hostBaseURL: string
let apiOrigin: string
let journeyFixture: { agentId: string; embedId?: string } | undefined

test.beforeAll(async () => {
	const apiPort = process.env.TALQO_API_PORT
	if (!apiPort) throw new Error("TALQO_API_PORT missing — scripts/test-e2e.ts provides it")
	apiOrigin = `http://127.0.0.1:${apiPort}`
	const template = await readFile(HOST_HTML_PATH, "utf8")

	server = createServer((req, res) => {
		const requestUrl = new URL(req.url ?? "/", "http://localhost")
		if (requestUrl.pathname === "/") {
			const token = requestUrl.searchParams.get("token") ?? ""
			res
				.writeHead(200, { "content-type": "text/html" })
				.end(template.replace("__TOKEN__", token).replace("__API_ORIGIN__", apiOrigin))
			return
		}
		const file =
			requestUrl.pathname === "/widget.js" || requestUrl.pathname === "/widget.css"
				? path.join(DIST, requestUrl.pathname.slice(1))
				: null
		if (!file) {
			res.writeHead(404).end()
			return
		}
		readFile(file)
			.then((content) => {
				res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/css" }).end(content)
			})
			.catch(() => res.writeHead(404).end())
	})
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve)
	})
	const address = server.address()
	if (typeof address !== "object" || !address) {
		throw new Error("stats host server failed to bind")
	}
	hostBaseURL = `http://127.0.0.1:${address.port}`
})

test.afterAll(() => {
	server.close()
})

test.afterEach(async ({ request }) => {
	const providerUrl = process.env.TALQO_SEED_AI_BASE_URL
	if (providerUrl) await expect(await request.post(`${new URL(providerUrl).origin}/control/reset`)).toBeOK()
	if (journeyFixture) {
		if (journeyFixture.embedId) await expect(await request.delete(`/api/embeds/${journeyFixture.embedId}`)).toBeOK()
		await expect(await request.delete(`/api/agents/${journeyFixture.agentId}`)).toBeOK()
		journeyFixture = undefined
	}
})

test("a recorded chat appears in the dashboard statistics after login", async ({ page, request }, testInfo) => {
	const providerUrl = process.env.TALQO_SEED_AI_BASE_URL
	if (!providerUrl) throw new Error("TALQO_SEED_AI_BASE_URL missing; scripts/test-e2e.ts provides it")
	await expect(await request.post(`${new URL(providerUrl).origin}/control/reset`)).toBeOK()

	const admin = { username: "admin", password: "admin123" }
	await expect(await request.post(`${apiOrigin}/api/auth/login`, { data: admin })).toBeOK()
	const agentName = `Stats ${testInfo.project.name} ${testInfo.retry}`
	const agentResponse = await request.post(`${apiOrigin}/api/agents`, {
		data: { name: agentName, systemPrompt: "You are the support assistant on our company website.", wordBlacklist: [] },
	})
	await expect(agentResponse).toBeOK()
	const { agent } = (await agentResponse.json()) as { agent: { id: string } }
	journeyFixture = { agentId: agent.id }
	const seedEmbeds = (await (await request.get(`${apiOrigin}/api/embeds`)).json()) as {
		embeds: { appearance: unknown }[]
	}
	const appearance = seedEmbeds.embeds[0]?.appearance
	if (!appearance) throw new Error("Shared seed embed is missing")
	const embedResponse = await request.post(`${apiOrigin}/api/embeds`, {
		data: { agentId: agent.id, name: "Stats test", appearance },
	})
	await expect(embedResponse).toBeOK()
	const { embed } = (await embedResponse.json()) as { embed: { embedToken: string; id: string } }
	journeyFixture.embedId = embed.id

	// Chat through the real widget; the fake provider answers immediately.
	await page.goto(`${hostBaseURL}/?token=${encodeURIComponent(embed.embedToken)}`)
	await page.getByRole("button", { name: "Open chat" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("textbox", { name: "Message" }).fill("Record this turn")
	await dialog.getByRole("button", { name: "Send" }).click()
	await expect(dialog.getByText("Unexpected fake provider request.", { exact: true })).toBeVisible()

	// The fake provider reports 12 input and 6 output tokens for a completed turn.
	await expect
		.poll(async () => {
			const response = await request.get(`${apiOrigin}/api/stats/overview?agentId=${agent.id}`)
			const body = (await response.json()) as {
				overview: { totals: { conversations: number; inputTokens: number; messages: number; outputTokens: number } }
			}
			return body.overview.totals
		})
		.toEqual({ conversations: 1, messages: 2, inputTokens: 12, outputTokens: 6 })

	// Log in through the real web app; the landing page must show the recorded statistics.
	await page.goto("/login")
	await page.getByLabel("Username").fill(admin.username)
	await page.getByLabel("Password", { exact: true }).fill(admin.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("heading", { name: "Welcome to Talqo" })).toBeVisible()
	await expect(page.getByRole("heading", { name: "Per-agent breakdown" })).toBeVisible()
	const agentRow = page.getByRole("row", { name: new RegExp(`^${agentName}`) })
	await expect(agentRow).toBeVisible()
	await expect(agentRow.getByRole("cell").nth(1)).toHaveText("1")
	await expect(agentRow.getByRole("cell").nth(2)).toHaveText("2")
	await expect(agentRow.getByRole("cell").nth(3)).toHaveText("18")

	// The analytics page reads the same statistics for the journey agent.
	await page.getByRole("link", { name: "Analytics" }).click()
	await expect(page).toHaveURL(/\/dashboard\/analytics/)
	await expect(page.getByText("Conversations (30 days)")).toBeVisible()
})
