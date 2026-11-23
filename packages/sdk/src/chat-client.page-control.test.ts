import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { tool } from "ai"
import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test"
import { z } from "zod"

import { ChatClientFrameV1 } from "./generated/models/chatClientFrameV1.zod"
import { createChatClient } from "./index"
import { createChatStorageKey, createMemoryStorage } from "./storage"

const configuration = {
	name: "Support",
	isAvailable: true,
	appearance: { language: "cs" },
	pageControl: { enabled: true, approvalInstructions: "Confirm totals." },
}

const originalFetch = globalThis.fetch

beforeAll(() => {
	GlobalRegistrator.register({ url: "http://localhost/shop" })
})

afterAll(() => {
	void GlobalRegistrator.unregister()
})

afterEach(() => {
	globalThis.fetch = originalFetch
})

function stubFetch() {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify(configuration), { status: 200 })) as unknown as typeof fetch
}

function clientWith(options: { exclude?: readonly Element[]; tools?: Record<string, unknown> } = {}) {
	return createChatClient({
		apiUrl: "http://api.test",
		embedToken: "embed",
		storage: createMemoryStorage(),
		pageControl: options.exclude ? { exclude: options.exclude, themeRoot: () => document.body } : undefined,
		tools: options.tools as Parameters<typeof createChatClient>[0]["tools"],
	})
}

function customTool(index: number) {
	return tool({
		description: `Tool ${index}`,
		inputSchema: z.object({}),
		execute: async () => ({}),
	})
}

function blockTabStorage() {
	const storage = globalThis.sessionStorage
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		value: {
			getItem: () => null,
			setItem: () => {
				throw new Error("blocked")
			},
			removeItem: () => {},
		},
	})
	return () => Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage })
}

function chatServer(handleFrame: (frame: z.output<typeof ChatClientFrameV1>, send: (message: object) => void) => void) {
	return Bun.serve({
		port: 0,
		fetch(request, host) {
			return host.upgrade(request) ? undefined : new Response(null, { status: 400 })
		},
		websocket: {
			message(ws, data) {
				const frame = ChatClientFrameV1.parse(JSON.parse(String(data)))
				handleFrame(frame, (message) => ws.send(JSON.stringify({ version: 1, ...message })))
			},
		},
	})
}

async function expectAdvertisedTools(
	{ enabled, blocked = false }: { enabled: boolean; blocked?: boolean },
	expected: string[],
) {
	globalThis.fetch = Object.assign(
		async () => Response.json({ ...configuration, pageControl: { ...configuration.pageControl, enabled } }),
		{ preconnect: originalFetch.preconnect },
	)
	const received: string[][] = []
	const server = chatServer((frame, send) => {
		if (frame.type !== "start") return
		received.push(frame.tools?.map(({ name }) => name) ?? [])
		const createdAt = "2026-11-20T00:00:00.000Z"
		send({
			type: "accepted",
			requestId: frame.requestId,
			generationId: "generation",
			userMessage: { id: "user", createdAt },
			assistantMessage: { id: "assistant", createdAt },
		})
		send({ type: "terminal", outcome: "completed" })
	})
	const restoreStorage = blocked ? blockTabStorage() : undefined
	const root = document.createElement("main")
	document.body.replaceChildren(root)
	const client = createChatClient({
		apiUrl: server.url.origin,
		embedToken: "embed",
		storage: createMemoryStorage(),
		pageControl: { exclude: [root] },
		tools: { lookup: customTool(0) },
	})
	try {
		await client.initialize()
		await client.sendMessage("Hello")
		expect(received).toEqual([expected])
		expect(client.getSnapshot().messages.at(-1)?.outcome).toBe("completed")
	} finally {
		client.dispose()
		restoreStorage?.()
		await server.stop(true)
	}
}

test("advertises website actions when the embed enables them", async () => {
	await expectAdvertisedTools({ enabled: true }, ["lookup", "talqo_page"])
})

test("keeps the page tool out when the embed disables it", async () => {
	await expectAdvertisedTools({ enabled: false }, ["lookup"])
})

test("keeps chat and custom tools available without tab storage", async () => {
	await expectAdvertisedTools({ enabled: true, blocked: true }, ["lookup"])
})

test("reports blocked tab storage even when restoring the chat fails", async () => {
	globalThis.fetch = (async (input: string) => {
		if (input.endsWith("/session")) throw new Error("Session temporarily unavailable")
		return Response.json(configuration)
	}) as unknown as typeof fetch
	const root = document.createElement("main")
	document.body.append(root)
	const apiUrl = "http://api.test"
	const embedToken = "embed"
	const chatStorage = createMemoryStorage()
	await chatStorage.setItem(
		createChatStorageKey(apiUrl, embedToken),
		JSON.stringify({ version: 1, credential: crypto.randomUUID() }),
	)
	const restoreStorage = blockTabStorage()
	try {
		const client = createChatClient({ apiUrl, embedToken, storage: chatStorage, pageControl: { exclude: [root] } })
		await expect(client.initialize()).rejects.toThrow("Session temporarily unavailable")
		expect(client.getSnapshot().notices).toContain("storage-unavailable")
		client.dispose()
	} finally {
		restoreStorage()
	}
})

test("requires the chat root before enabling website actions", async () => {
	stubFetch()
	const client = clientWith({ exclude: [] })
	await expect(client.initialize()).rejects.toThrow("Page control requires the chat root in pageControl.exclude")
	client.dispose()
})

test("rejects the reserved page tool name", async () => {
	stubFetch()
	const root = document.createElement("main")
	document.body.append(root)
	const reserved = clientWith({ exclude: [root], tools: { talqo_page: customTool(0) } })
	await expect(reserved.initialize()).rejects.toThrow("Reserved client tool name: talqo_page")
	reserved.dispose()
})

test("keeps chat available with eight registered tools", async () => {
	stubFetch()
	const root = document.createElement("main")
	document.body.append(root)
	const full = clientWith({
		exclude: [root],
		tools: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`tool${index}`, customTool(index)])),
	})
	await full.initialize()
	expect(full.getSnapshot().activity).toBe("idle")
	full.dispose()
})

test("restores a session on retry without reporting the page tool as a custom slot", async () => {
	let sessionRequests = 0
	globalThis.fetch = (async (input: string) => {
		if (!input.endsWith("/session")) return Response.json(configuration)
		sessionRequests++
		if (sessionRequests === 1) throw new Error("Session temporarily unavailable")
		return Response.json({ messages: [] })
	}) as unknown as typeof fetch
	const apiUrl = "http://api.test"
	const embedToken = "embed"
	const storage = createMemoryStorage()
	await storage.setItem(
		createChatStorageKey(apiUrl, embedToken),
		JSON.stringify({ version: 1, credential: crypto.randomUUID() }),
	)
	const root = document.createElement("main")
	document.body.append(root)
	const client = createChatClient({
		apiUrl,
		embedToken,
		storage,
		pageControl: { exclude: [root] },
		tools: Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`tool${index}`, customTool(index)])),
	})
	const warning = spyOn(console, "warn").mockImplementation(() => {})
	try {
		await expect(client.initialize()).rejects.toThrow("Session temporarily unavailable")
		await client.initialize()
		expect(client.getSnapshot().activity).toBe("idle")
		expect(warning).not.toHaveBeenCalledWith(
			"TalqoSDK: website actions unavailable because all 8 client tool slots are in use",
		)
	} finally {
		warning.mockRestore()
		client.dispose()
	}
})

async function expectRecoveredPageTurn(rejected: boolean) {
	const credential = crypto.randomUUID()
	const requestId = crypto.randomUUID()
	const pageSession = crypto.randomUUID()
	const generationId = "generation"
	const text = "Read this page"
	const createdAt = "2026-11-20T00:00:00.000Z"
	const userMessage = { id: "user", createdAt }
	const assistantMessage = { id: "assistant", createdAt }
	const toolReply = Promise.withResolvers<unknown>()
	const firstResume = Promise.withResolvers<void>()
	let resumes = 0
	let finished = false
	globalThis.fetch = (async (input: string) => {
		if (!input.endsWith("/session")) return Response.json(configuration)
		return Response.json({
			...(finished ? {} : { activeGeneration: { id: generationId } }),
			messages: [
				{ ...userMessage, role: "user", text, outcome: "completed", parts: [{ type: "text", text }] },
				{
					...assistantMessage,
					role: "assistant",
					text: "Already stored",
					outcome: finished ? "completed" : "streaming",
					parts: [{ type: "text", text: "Already stored" }],
				},
			],
		})
	}) as unknown as typeof fetch
	const server = chatServer((frame, send) => {
		if (frame.type === "resume") {
			if (rejected) {
				finished = true
				send({ type: "rejected", code: "invalid-request", status: 400 })
				return
			}
			if (++resumes === 1) {
				firstResume.resolve()
				return
			}
			send({ type: "accepted", requestId, generationId, userMessage, assistantMessage })
			const target = { assistantMessageId: assistantMessage.id, index: 0 }
			send({ ...target, type: "part", part: { type: "text", text: "Already " } })
			send({ ...target, type: "delta", text: "stored" })
			send({
				type: "tool-call",
				toolCallId: "observe",
				toolName: "talqo_page",
				input: { action: "observe" },
				messages: [],
			})
		} else if (frame.type === "tool-result" || frame.type === "tool-error") {
			toolReply.resolve(frame)
			send({ type: "terminal", outcome: "completed" })
		}
	})
	const apiUrl = server.url.origin
	const embedToken = "embed"
	const continuationKey = `talqo:page-turn:${apiUrl}:${embedToken}`
	const storage = createMemoryStorage()
	const root = document.createElement("main")
	document.body.replaceChildren(root)
	const options = { apiUrl, embedToken, storage, pageControl: { exclude: [root] }, recoveryDelays: [0] }
	const firstClient = createChatClient(options)
	const client = rejected ? firstClient : createChatClient(options)
	const replyCompleted = Promise.withResolvers<void>()
	const unsubscribe = client.subscribe(() => {
		if (
			client
				.getSnapshot()
				.messages.some((message) => message.id === assistantMessage.id && message.outcome === "completed")
		)
			replyCompleted.resolve()
	})
	try {
		await storage.setItem(createChatStorageKey(apiUrl, embedToken), JSON.stringify({ version: 1, credential }))
		sessionStorage.setItem(continuationKey, JSON.stringify({ credential, requestId, pageSession, generationId, text }))
		await firstClient.initialize()
		if (!rejected) {
			await firstResume.promise
			firstClient.dispose()
			await client.initialize()
			const result = await toolReply.promise
			expect(result).toMatchObject({ type: "tool-result", toolCallId: "observe" })
			expect(result).toHaveProperty("output.snapshot")
		}
		await replyCompleted.promise
		expect(client.getSnapshot().messages).toMatchObject([
			{ id: userMessage.id, role: "user", text },
			{ id: assistantMessage.id, role: "assistant", text: "Already stored", outcome: "completed" },
		])
	} finally {
		unsubscribe()
		if (!rejected) firstClient.dispose()
		client.dispose()
		sessionStorage.removeItem(continuationKey)
		await server.stop(true)
	}
}

test("resumes after another page load during reattachment and executes the next tool call", async () => {
	await expectRecoveredPageTurn(false)
})

test("loads the completed transcript when the server rejects an expired page resume", async () => {
	await expectRecoveredPageTurn(true)
})
