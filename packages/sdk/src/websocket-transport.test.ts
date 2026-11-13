import { tool } from "ai"
import { expect, test } from "bun:test"
import { z } from "zod"

import { createChatClient } from "./chat-client.ts"
import { captureClientTools } from "./client-tools.ts"
import { createChatStorageKey, createMemoryStorage } from "./storage.ts"
import { createWebSocketChatTransport } from "./websocket-transport.ts"

const CREDENTIAL = "22222222-2222-4222-8222-222222222222"
const REQUEST_ID = "11111111-1111-4111-8111-111111111111"
const accepted = {
	version: 1,
	type: "accepted",
	requestId: REQUEST_ID,
	generationId: "generation",
	userMessage: { id: "user", createdAt: "2026-11-12T00:00:00Z" },
	assistantMessage: { id: "assistant", createdAt: "2026-11-12T00:00:01Z" },
}
const call = (id: string) => ({
	version: 1,
	type: "tool-call",
	toolCallId: id,
	toolName: "lookup",
	input: {},
	messages: [{ role: "user", content: "Read this page" }],
})

test("uses first-frame credentials and enforces the 16-call budget across parallel calls, failures, and duplicates", async () => {
	let executed = 0
	let requestUrl = ""
	const received: unknown[] = []
	const registry = captureClientTools({
		lookup: tool({
			inputSchema: z.object({}),
			execute: () => {
				executed++
				if (executed % 2) throw new Error("Host page failed")
				return { value: "page data" }
			},
		}),
	})
	const server = Bun.serve({
		port: 0,
		fetch(request, host) {
			requestUrl = request.url
			return host.upgrade(request) ? undefined : new Response(null, { status: 400 })
		},
		websocket: {
			message(ws, data) {
				const frame = JSON.parse(String(data)) as { type: string; credential?: string }
				received.push(frame)
				if (frame.type === "start") {
					ws.send(JSON.stringify(accepted))
					for (let index = 0; index < 17; index++) ws.send(JSON.stringify(call(`call-${index}`)))
					ws.send(JSON.stringify(call("call-0")))
				} else if (received.length === 18)
					ws.send(JSON.stringify({ version: 1, type: "terminal", outcome: "completed" }))
			},
		},
	})
	try {
		const transport = createWebSocketChatTransport(registry)
		const events = await Array.fromAsync(
			await transport.sendMessage({
				apiUrl: server.url.origin,
				embedToken: "embed",
				credential: CREDENTIAL,
				requestId: REQUEST_ID,
				text: "hello",
				signal: new AbortController().signal,
			}),
		)
		expect(events.map((event) => event.type)).toEqual(["accepted", "terminal"])
		expect(requestUrl).toBe(`${server.url.origin}/api/chat/embed/socket`)
		expect(requestUrl).not.toContain(CREDENTIAL)
		expect(received[0]).toMatchObject({ type: "start", credential: CREDENTIAL, tools: [{ name: "lookup" }] })
		expect(executed).toBe(16)
		expect(received.filter((frame) => (frame as { type: string }).type === "tool-error")).toHaveLength(9)
	} finally {
		await server.stop(true)
	}
})

test("processes cancellation while a browser execute promise is still pending", async () => {
	const started = Promise.withResolvers<void>()
	let aborted = false
	const registry = captureClientTools({
		lookup: tool({
			inputSchema: z.object({}),
			execute: (_input, options) =>
				new Promise<null>((resolve) => {
					options.abortSignal?.addEventListener(
						"abort",
						() => {
							aborted = true
							resolve(null)
						},
						{ once: true },
					)
					started.resolve()
				}),
		}),
	})
	const frames: string[] = []
	const server = Bun.serve({
		port: 0,
		fetch(request, host) {
			return host.upgrade(request) ? undefined : new Response(null, { status: 400 })
		},
		websocket: {
			message(ws, data) {
				const frame = JSON.parse(String(data)) as { type: string }
				frames.push(frame.type)
				if (frame.type === "start") {
					ws.send(JSON.stringify(accepted))
					ws.send(JSON.stringify(call("pending")))
				}
				if (frame.type === "cancel") {
					ws.send(JSON.stringify({ version: 1, type: "terminal", outcome: "cancelled" }))
					ws.close()
				}
			},
		},
	})
	try {
		const transport = createWebSocketChatTransport(registry)
		const input = {
			apiUrl: server.url.origin,
			embedToken: "embed",
			credential: CREDENTIAL,
			requestId: REQUEST_ID,
			text: "hello",
			signal: new AbortController().signal,
		}
		const events = Array.fromAsync(await transport.sendMessage(input))
		await started.promise
		await transport.cancelResponse(input)
		expect(await events).toMatchObject([{ type: "accepted" }, { type: "terminal", outcome: "cancelled" }])
		expect(aborted).toBe(true)
		expect(frames).toEqual(["start", "cancel"])
	} finally {
		await server.stop(true)
	}
})

test("cancels connection setup without falling back to HTTP cancellation", async () => {
	let httpCalls = 0
	const transport = createWebSocketChatTransport(captureClientTools(), {
		fetch: async () => {
			httpCalls++
			throw new Error("Unexpected HTTP request")
		},
	})
	const input = {
		apiUrl: "http://127.0.0.1:1",
		embedToken: "embed",
		credential: CREDENTIAL,
		requestId: REQUEST_ID,
		text: "hello",
		signal: new AbortController().signal,
	}
	const sending = transport.sendMessage(input).catch((error: unknown) => error)
	await transport.cancelResponse(input)
	await expect(sending).resolves.toMatchObject({ message: "Chat send cancelled before connection" })
	expect(httpCalls).toBe(0)
})

test("recovers an original server-only request without advertising newly registered browser tools", async () => {
	let advertised: unknown
	const server = Bun.serve({
		port: 0,
		fetch(request, host) {
			const pathname = new URL(request.url).pathname
			if (pathname.endsWith("/socket")) return host.upgrade(request) ? undefined : new Response(null, { status: 400 })
			if (pathname.startsWith("/api/embed-config/"))
				return Response.json({ name: "Chat", appearance: {}, isAvailable: true })
			return Response.json({
				messages: [
					{
						id: "user",
						requestId: REQUEST_ID,
						role: "user",
						text: "hello",
						parts: [{ type: "text", text: "hello" }],
						outcome: "completed",
						createdAt: "2026-11-12T00:00:00Z",
					},
					{
						id: "assistant",
						requestId: REQUEST_ID,
						role: "assistant",
						text: "answer",
						parts: [{ type: "text", text: "answer" }],
						outcome: "completed",
						createdAt: "2026-11-12T00:00:01Z",
					},
				],
			})
		},
		websocket: {
			message(ws, data) {
				const frame = JSON.parse(String(data)) as { type: string; tools: unknown }
				if (frame.type === "start") {
					advertised = frame.tools
					ws.send(JSON.stringify(accepted))
					ws.send(JSON.stringify({ version: 1, type: "terminal", outcome: "completed" }))
				}
			},
		},
	})
	const storage = createMemoryStorage()
	await storage.setItem(
		createChatStorageKey(server.url.origin, "embed"),
		JSON.stringify({ version: 1, credential: CREDENTIAL, pending: { requestId: REQUEST_ID, text: "hello" } }),
	)
	const client = createChatClient({
		apiUrl: server.url.origin,
		embedToken: "embed",
		storage,
		recoveryDelays: [0],
		tools: { newTool: tool({ inputSchema: z.object({}), execute: () => null }) },
	})
	const recovered = Promise.withResolvers<void>()
	client.subscribe(() => {
		if (client.getSnapshot().activity === "idle" && client.getSnapshot().messages.length === 2) recovered.resolve()
	})
	try {
		await client.initialize()
		await recovered.promise
		expect(advertised).toEqual([])
		expect(client.getSnapshot().messages.at(-1)?.text).toBe("answer")
	} finally {
		client.dispose()
		await server.stop(true)
	}
})
