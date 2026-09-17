import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import path from "node:path"

const DIST = path.resolve(import.meta.dirname, "../../widget/dist")
const HOST_HTML_PATH = path.resolve(import.meta.dirname, "fixtures/host.html")

const DEFAULT_PRIMARY_RGB = "rgb(26, 127, 75)"

let server: Server
let baseURL: string
let apiOrigin: string
let chatFixture: { agentId: string; embedId?: string } | undefined

test.beforeAll(async () => {
	const token = "talqo-development-embed-token"
	const apiPort = process.env.TALQO_API_PORT
	if (!apiPort) throw new Error("TALQO_API_PORT missing — scripts/test-e2e.ts provides it")

	// A different origin from the host page below, so the config request exercises CORS.
	apiOrigin = `http://127.0.0.1:${apiPort}`
	const template = await readFile(HOST_HTML_PATH, "utf8")
	const configured = template.replace("__TOKEN__", token).replace("__API_ORIGIN__", apiOrigin)
	const unknownToken = template.replace("__TOKEN__", "not-a-real-token").replace("__API_ORIGIN__", apiOrigin)

	server = createServer((req, res) => {
		const requestUrl = new URL(req.url ?? "/", "http://localhost")
		if (requestUrl.pathname === "/") {
			const perTestToken = requestUrl.searchParams.get("token")
			res
				.writeHead(200, { "content-type": "text/html" })
				.end(
					perTestToken ? template.replace("__TOKEN__", perTestToken).replace("__API_ORIGIN__", apiOrigin) : configured,
				)
			return
		}
		if (requestUrl.pathname === "/unknown-token") {
			res.writeHead(200, { "content-type": "text/html" }).end(unknownToken)
			return
		}
		const file =
			requestUrl.pathname === "/widget.js" ||
			requestUrl.pathname === "/widget.css" ||
			requestUrl.pathname === "/preview.html"
				? path.join(DIST, requestUrl.pathname.slice(1))
				: null
		if (!file) {
			res.writeHead(404).end()
			return
		}
		readFile(file)
			.then((content) => {
				const contentType = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html"
				res.writeHead(200, { "content-type": contentType }).end(content)
			})
			.catch(() => res.writeHead(404).end())
	})
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve)
	})
	const address = server.address()
	if (typeof address !== "object" || !address) {
		throw new Error("embed stub server failed to bind")
	}
	baseURL = `http://127.0.0.1:${address.port}`
})

test.afterAll(() => {
	server.close()
})

test.afterEach(async ({ request }, testInfo) => {
	if (!testInfo.title.includes("durable multi-turn chat")) return
	const providerUrl = process.env.TALQO_SEED_AI_BASE_URL
	if (providerUrl) await expect(await request.post(`${new URL(providerUrl).origin}/control/reset`)).toBeOK()
	if (chatFixture) {
		if (chatFixture.embedId) await expect(await request.delete(`/api/embeds/${chatFixture.embedId}`)).toBeOK()
		await expect(await request.delete(`/api/agents/${chatFixture.agentId}`)).toBeOK()
		chatFixture = undefined
	}
})

test("built widget boots, mounts, and stays styled on a bare host page", async ({ page }) => {
	const errors: string[] = []
	page.on("pageerror", (error) => errors.push(String(error)))
	// A blocked CORS request only logs, so pageerror alone would miss a CORS regression.
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text())
	})

	await page.goto(baseURL)
	await expect(page.locator("#talqo-widget")).toBeAttached()

	const launcher = page.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()

	await launcher.click()
	const dialog = page.getByRole("dialog")
	await expect(dialog).toBeVisible()

	const closeButton = dialog.getByRole("button", { name: "Close chat" })
	await expect(closeButton).toHaveCSS("border-top-width", "0px")
	await expect(closeButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
	const input = dialog.getByRole("textbox")
	await expect(input).toHaveCSS("border-top-width", "1px")
	await expect(input).toHaveCSS("border-top-style", "solid")

	await closeButton.click()
	await expect(dialog).toBeHidden()

	await launcher.click()
	await expect(dialog).toBeVisible()

	expect(errors).toEqual([])
})

test("built preview executes production assets", async ({ page }) => {
	const assets: string[] = []
	page.on("request", (request) => {
		if (/\/widget\.(?:css|js)$/.test(new URL(request.url()).pathname)) assets.push(request.url())
	})

	await page.goto(`${baseURL}/preview.html?title=Production%20preview`)

	await expect(page.locator(".talqo-widget")).toBeVisible()
	await page.getByRole("button", { name: "Open chat" }).click()
	await expect(page.getByText("Production preview")).toBeVisible()
	expect(assets).toContain(`${baseURL}/widget.css`)
	expect(assets).toContain(`${baseURL}/widget.js`)
})

test("built widget boots in a sandboxed CDN-only preview frame", async ({ page }) => {
	await page.goto(`${baseURL}/missing`)
	await page.setContent('<iframe title="CDN-only preview"></iframe>')
	const srcDoc = `<!doctype html><html><body><div id="talqo-widget"></div><script src="${baseURL}/widget.js" data-talqo-preview data-talqo-parent-origin="${baseURL}"></script></body></html>`

	await page.locator("iframe").evaluate(
		(frame, config) => {
			const iframe = frame as HTMLIFrameElement
			window.addEventListener("message", (event) => {
				if (event.source !== iframe.contentWindow || event.data?.type !== "ready") return
				iframe.contentWindow?.postMessage(config.message, "*")
			})
			iframe.setAttribute("sandbox", "allow-scripts")
			iframe.srcdoc = config.srcDoc
		},
		{
			srcDoc,
			message: {
				source: "talqo-preview",
				version: 1,
				type: "config",
				appearance: {
					light: {
						primary: "#1a7f4b",
						textOnPrimary: "#ffffff",
						background: "#ffffff",
						surface: "#f5f5f5",
						text: "#171717",
					},
					position: "bottom-right",
					theme: "light",
				},
			},
		},
	)

	await expect(page.frameLocator("iframe").getByRole("button", { name: "Open chat" })).toBeVisible()
})

test("widget fetches its palette by public token across origins", async ({ page }) => {
	await page.goto(baseURL)

	// One assertion for the whole chain: token lookup, CORS, and the fetched color painting.
	await expect(page.getByRole("button", { name: "Open chat" })).toHaveCSS("background-color", DEFAULT_PRIMARY_RGB)
})

test("widget's panel paints background, and its input box paints surface", async ({ page }) => {
	await page.goto(baseURL)
	await page.getByRole("button", { name: "Open chat" }).click()

	// The panel shell paints the explicit background color (#ffffff), not surface.
	await expect(page.getByRole("dialog")).toHaveCSS("background-color", "rgb(255, 255, 255)")
	// The message input paints the distinct surface color (#f5f5f5).
	await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCSS("background-color", "rgb(245, 245, 245)")
})

test("widget still renders in default colors when its token is unknown", async ({ page }) => {
	await page.goto(`${baseURL}/unknown-token`)

	const launcher = page.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	await expect(launcher).toHaveCSS("background-color", DEFAULT_PRIMARY_RGB)
})

test("widget streams a durable multi-turn chat, cancels, and starts a new chat without resetting allowance", async ({
	page,
	request,
}, testInfo) => {
	const providerUrl = process.env.TALQO_SEED_AI_BASE_URL
	if (!providerUrl) throw new Error("TALQO_SEED_AI_BASE_URL missing; scripts/test-e2e.ts provides it")
	const providerControlOrigin = new URL(providerUrl).origin
	await expect(await request.post(`${providerControlOrigin}/control/reset`)).toBeOK()
	const admin = { username: "admin", password: "admin123" }
	await expect(await request.post(`${apiOrigin}/api/auth/login`, { data: admin })).toBeOK()
	const agentResponse = await request.post(`${apiOrigin}/api/agents`, {
		data: {
			name: `Chat ${testInfo.project.name} ${testInfo.retry}`,
			systemPrompt: "You are the support assistant on our company website.",
			wordBlacklist: ["Intercom", "Zendesk"],
		},
	})
	await expect(agentResponse).toBeOK()
	const { agent } = (await agentResponse.json()) as { agent: { id: string } }
	chatFixture = { agentId: agent.id }
	const baselineEmbeds = (await (await request.get(`${apiOrigin}/api/embeds`)).json()) as {
		embeds: { appearance: unknown }[]
	}
	const appearance = baselineEmbeds.embeds[0]?.appearance
	if (!appearance) throw new Error("Shared seed embed is missing")
	const embedResponse = await request.post(`${apiOrigin}/api/embeds`, {
		data: { agentId: agent.id, name: "Chat test", appearance },
	})
	await expect(embedResponse).toBeOK()
	const { embed } = (await embedResponse.json()) as { embed: { embedToken: string; id: string } }
	chatFixture.embedId = embed.id

	await page.goto(`${baseURL}/?token=${encodeURIComponent(embed.embedToken)}`)
	await page.getByRole("button", { name: "Open chat" }).click()
	const dialog = page.getByRole("dialog")
	const messageInput = dialog.getByRole("textbox", { name: "Message" })
	const send = async (text: string) => {
		await messageInput.fill(text)
		await dialog.getByRole("button", { name: "Send" }).click()
	}

	await send("Give me the first answer")
	await expect(dialog.getByText("First", { exact: true })).toBeVisible()
	await expect(await request.post(`${providerControlOrigin}/control/release`)).toBeOK()
	await expect(dialog.getByText("First streamed answer.", { exact: true })).toBeVisible()

	await send("Prove you received the earlier turn")
	await expect(
		dialog.getByText("History verified: system prompt, first question, and first answer.", { exact: true }),
	).toBeVisible()
	const captured = (await (await request.get(`${providerControlOrigin}/control/requests`)).json()) as {
		requests: { messages: { content: unknown; role: string }[] }[]
	}
	expect(captured.requests[1]?.messages).toEqual([
		{ role: "system", content: expect.stringContaining("support assistant") },
		{ role: "user", content: "Give me the first answer" },
		{ role: "assistant", content: "First streamed answer." },
		{ role: "user", content: "Prove you received the earlier turn" },
	])

	await page.reload()
	await page.getByRole("button", { name: "Open chat" }).click()
	await expect(dialog.getByText("Give me the first answer", { exact: true })).toBeVisible()
	await expect(dialog.getByText("First streamed answer.", { exact: true })).toBeVisible()
	await expect(dialog.getByText("Prove you received the earlier turn", { exact: true })).toBeVisible()
	await expect(
		dialog.getByText("History verified: system prompt, first question, and first answer.", { exact: true }),
	).toBeVisible()

	await send("Stream until I cancel")
	// The API's blacklist look-behind withholds the provider chunk tail until cancellation confirms it is safe.
	await expect(dialog.getByText("Cancellation partial output", { exact: true })).toBeVisible()
	await dialog.getByRole("button", { name: "Stop generating" }).click()
	await expect(dialog.getByText("Response cancelled", { exact: true })).toBeVisible()
	await expect(dialog.getByRole("button", { name: "Stop generating" })).toHaveCount(0)

	await page.evaluate(() => {
		const entry = Object.entries(localStorage).find(([key]) => key.startsWith("talqo:chat:v1:"))
		const stored: unknown = entry?.[1] ? JSON.parse(entry[1]) : undefined
		if (!stored || typeof stored !== "object" || !("credential" in stored) || typeof stored.credential !== "string") {
			throw new Error("Expected the widget to persist its session credential")
		}
		;(window as unknown as { e2eOldCredential?: string }).e2eOldCredential = stored.credential
	})

	await dialog.getByRole("button", { name: "New chat" }).click()
	await expect(dialog.getByText("Hi there! How can I help you today?", { exact: true })).toBeVisible()
	await expect(dialog.getByText("Give me the first answer", { exact: true })).toHaveCount(0)

	const oldSession = await page.evaluate(async (origin) => {
		const credential = (window as unknown as { e2eOldCredential?: string }).e2eOldCredential
		if (!credential) throw new Error("Expected retained E2E session credential")
		const response = await fetch(`${origin}/api/chat/session`, {
			headers: { Authorization: `Bearer ${credential}` },
		})
		if (!response.ok) throw new Error(`Old session lookup failed with ${response.status}`)
		return (await response.json()) as { messages: { outcome: string; role: string; text: string }[] }
	}, apiOrigin)
	expect(oldSession.messages).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ role: "assistant", text: "First streamed answer.", outcome: "completed" }),
			expect.objectContaining({
				role: "assistant",
				text: "Cancellation partial output remains visible",
				outcome: "cancelled",
			}),
		]),
	)

	await send("The allowance must not reset")
	await expect(dialog.getByRole("alert")).toContainText("daily message allowance has been reached")
})
