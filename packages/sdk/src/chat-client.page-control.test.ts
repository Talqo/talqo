import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { tool } from "ai"
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { z } from "zod"

import { createChatClient } from "./index"
import { createMemoryStorage } from "./storage"

const configuration = {
	name: "Support",
	isAvailable: true,
	appearance: { language: "cs" },
	pageControl: { enabled: true, approvalInstructions: "Confirm totals." },
}

const originalFetch = globalThis.fetch
let storageFails = false

beforeAll(() => {
	GlobalRegistrator.register({ url: "http://localhost/shop" })
})

afterAll(() => {
	void GlobalRegistrator.unregister()
})

afterEach(() => {
	globalThis.fetch = originalFetch
	storageFails = false
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

test("installs website actions when the embed enables them", async () => {
	stubFetch()
	const root = document.createElement("main")
	document.body.append(root)
	const client = clientWith({ exclude: [root] })
	await client.initialize()
	expect(client.getSnapshot().configuration?.pageControl).toMatchObject({ enabled: true })
	client.dispose()
})

test("skips website actions when tab storage is unavailable", async () => {
	stubFetch()
	const root = document.createElement("main")
	document.body.append(root)
	const storage = globalThis.sessionStorage
	Object.defineProperty(globalThis, "sessionStorage", {
		configurable: true,
		value: {
			getItem: () => null,
			setItem: () => {
				storageFails = true
				throw new Error("blocked")
			},
			removeItem: () => {},
		},
	})
	try {
		const client = clientWith({ exclude: [root] })
		await client.initialize()
		expect(storageFails).toBe(true)
		client.dispose()
	} finally {
		Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage })
	}
})

test("requires the chat root before enabling website actions", async () => {
	stubFetch()
	const client = clientWith({ exclude: [] })
	await expect(client.initialize()).rejects.toThrow("Page control requires the chat root in pageControl.exclude")
	client.dispose()
})

test("rejects the reserved page tool name and a full tool list", async () => {
	stubFetch()
	const root = document.createElement("main")
	document.body.append(root)
	const reserved = clientWith({ exclude: [root], tools: { talqo_page: customTool(0) } })
	await expect(reserved.initialize()).rejects.toThrow("Reserved client tool name: talqo_page")
	reserved.dispose()
	const full = clientWith({
		exclude: [root],
		tools: Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`tool${index}`, customTool(index)])),
	})
	await expect(full.initialize()).rejects.toThrow("Page control uses one of 8 client tools")
	full.dispose()
})

test("keeps the page tool out when the embed disables it", async () => {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ ...configuration, pageControl: { enabled: false, approvalInstructions: "x" } }), {
			status: 200,
		})) as unknown as typeof fetch
	const root = document.createElement("main")
	document.body.append(root)
	const client = clientWith({ exclude: [root] })
	await client.initialize()
	expect(client.getSnapshot().configuration?.pageControl).toMatchObject({ enabled: false })
	client.dispose()
})
