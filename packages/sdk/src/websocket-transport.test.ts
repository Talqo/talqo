import { tool } from "ai"
import { expect, test } from "bun:test"
import { z } from "zod"

import { createChatClient } from "./chat-client.ts"
import { captureClientTools } from "./client-tools.ts"
import { createChatStorageKey, createMemoryStorage, readChatStorageRecord } from "./storage.ts"
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

function recordingChatServer(onFrame: (ws: Bun.ServerWebSocket<undefined>, frame: { type: string }) => void): {
	server: ReturnType<typeof Bun.serve>
	frames: string[]
} {
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
				onFrame(ws, frame)
			},
		},
	})
	return { server, frames }
}

function sendInput(apiUrl: string) {
	return {
		apiUrl,
		embedToken: "embed",
		credential: CREDENTIAL,
		requestId: REQUEST_ID,
		text: "hello",
		signal: new AbortController().signal,
	}
}

async function startedTurn(apiUrl: string) {
	const transport = createWebSocketChatTransport(captureClientTools(), { cancelTimeoutMs: 50 })
	const input = sendInput(apiUrl)
	const events = (await transport.sendMessage(input))[Symbol.asyncIterator]()
	expect(await events.next()).toMatchObject({ value: { type: "accepted" }, done: false })
	return { transport, input, events }
}

test("rejects unknown error codes after validating the frame", async () => {
	const server = Bun.serve({
		port: 0,
		fetch(request, host) {
			return host.upgrade(request) ? undefined : new Response(null, { status: 400 })
		},
		websocket: {
			message(ws) {
				ws.send(JSON.stringify(accepted))
				ws.send(
					JSON.stringify({
						version: 1,
						type: "error",
						outcome: "failed",
						error: { code: "unknown-code", retriable: true, newChatAvailable: false },
					}),
				)
			},
		},
	})
	try {
		const transport = createWebSocketChatTransport(captureClientTools())
		const events = await transport.sendMessage({
			apiUrl: server.url.origin,
			embedToken: "embed",
			credential: CREDENTIAL,
			requestId: REQUEST_ID,
			text: "hello",
			signal: new AbortController().signal,
		})
		const error: unknown = await Array.fromAsync(events).catch((cause: unknown) => cause)
		expect(error).toMatchObject({ detail: { code: "invalid-response" } })
	} finally {
		await server.stop(true)
	}
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
	const { server, frames } = recordingChatServer((ws, frame) => {
		if (frame.type === "start") {
			ws.send(JSON.stringify(accepted))
			ws.send(JSON.stringify(call("pending")))
		}
		if (frame.type === "cancel") {
			ws.send(JSON.stringify({ version: 1, type: "terminal", outcome: "cancelled" }))
			ws.close()
		}
	})
	try {
		const transport = createWebSocketChatTransport(registry)
		const input = sendInput(server.url.origin)
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
	const input = sendInput("http://127.0.0.1:1")
	const sending = transport.sendMessage(input).catch((error: unknown) => error)
	await transport.cancelResponse(input)
	await expect(sending).resolves.toMatchObject({ message: "Chat send cancelled before connection" })
	expect(httpCalls).toBe(0)
})

for (const disconnect of ["closes", "stays open"] as const) {
	test(`reports unconfirmed Stop when the socket ${disconnect} without a terminal frame`, async () => {
		const { server, frames } = recordingChatServer((ws, frame) => {
			if (frame.type === "start") ws.send(JSON.stringify(accepted))
			if (frame.type === "cancel" && disconnect === "closes") ws.close()
		})
		try {
			const { transport, input, events } = await startedTurn(server.url.origin)

			await expect(transport.cancelResponse(input)).rejects.toThrow("cancel-failed")
			await expect(events.next()).rejects.toThrow("cancel-failed")
			expect(frames).toEqual(["start", "cancel"])
		} finally {
			await server.stop(true)
		}
	})
}

test("keeps the server rejection when a cancel is refused", async () => {
	const { server } = recordingChatServer((ws, frame) => {
		if (frame.type === "start") ws.send(JSON.stringify(accepted))
		if (frame.type === "cancel")
			ws.send(
				JSON.stringify({
					version: 1,
					type: "rejected",
					code: "chat-session-unauthorized",
					status: 401,
				}),
			)
	})
	try {
		const { transport, input, events } = await startedTurn(server.url.origin)

		await expect(transport.cancelResponse(input)).rejects.toMatchObject({
			detail: { code: "chat-session-unauthorized", status: 401 },
		})
		await expect(events.next()).rejects.toMatchObject({
			detail: { code: "chat-session-unauthorized", status: 401 },
		})
	} finally {
		await server.stop(true)
	}
})

test("does not start a turn when the handshake finishes after a cancel", async () => {
	const upgradeStarted = Promise.withResolvers<void>()
	const releaseUpgrade = Promise.withResolvers<void>()
	const handshakeSettled = Promise.withResolvers<void>()
	const frames: string[] = []
	const server = Bun.serve({
		port: 0,
		async fetch(request, host) {
			upgradeStarted.resolve()
			await releaseUpgrade.promise
			const upgraded = host.upgrade(request)
			if (!upgraded) handshakeSettled.resolve()
			return upgraded ? undefined : new Response(null, { status: 400 })
		},
		websocket: {
			open() {
				handshakeSettled.resolve()
			},
			close() {
				handshakeSettled.resolve()
			},
			message(_ws, data) {
				frames.push((JSON.parse(String(data)) as { type: string }).type)
			},
		},
	})
	try {
		const transport = createWebSocketChatTransport(captureClientTools(), { cancelTimeoutMs: 100 })
		const input = sendInput(server.url.origin)
		const sending = transport.sendMessage(input).catch((error: unknown) => error)
		await upgradeStarted.promise
		const cancelling = transport.cancelResponse(input)
		releaseUpgrade.resolve()
		await cancelling
		await handshakeSettled.promise

		expect(frames).not.toContain("start")
		expect(await sending).toMatchObject({ name: "ChatTransportError" })
	} finally {
		releaseUpgrade.resolve()
		await server.stop(true)
	}
})

test("stopping before dispatch cannot open a turn during asynchronous storage cleanup", async () => {
	const cleanup = Promise.withResolvers<void>()
	const cleanupStarted = Promise.withResolvers<void>()
	let starts = 0
	let actions = 0
	let delayCleanup = false
	const server = Bun.serve({
		port: 0,
		fetch(request, host) {
			if (new URL(request.url).pathname.endsWith("/socket"))
				return host.upgrade(request) ? undefined : new Response(null, { status: 400 })
			return Response.json({ name: "Chat", appearance: {}, isAvailable: true })
		},
		websocket: {
			message(ws, data) {
				const frame = JSON.parse(String(data)) as { type: string }
				if (frame.type === "start") {
					starts++
					ws.send(JSON.stringify(accepted))
					if (starts > 1) ws.send(JSON.stringify(call("unexpected")))
					else ws.send(JSON.stringify({ version: 1, type: "terminal", outcome: "completed" }))
				}
			},
		},
	})
	const memory = createMemoryStorage()
	const client = createChatClient({
		apiUrl: server.url.origin,
		embedToken: "embed",
		storage: {
			...memory,
			async setItem(key, value) {
				await memory.setItem(key, value)
				if (delayCleanup && readChatStorageRecord(value)?.pending === undefined) {
					cleanupStarted.resolve()
					await cleanup.promise
				}
			},
		},
		tools: {
			lookup: tool({
				inputSchema: z.object({}),
				execute: () => {
					actions++
					return null
				},
			}),
		},
	})
	try {
		await client.initialize()
		await client.sendMessage("first")
		delayCleanup = true
		const sending = client.sendMessage("second").catch((error: unknown) => error)
		const stopping = client.cancelResponse()
		await cleanupStarted.promise
		expect(await sending).toMatchObject({ message: "Chat response cancelled" })
		expect(starts).toBe(1)
		expect(actions).toBe(0)
		cleanup.resolve()
		await stopping
		expect(client.getSnapshot().activity).toBe("idle")
	} finally {
		cleanup.resolve()
		client.dispose()
		await server.stop(true)
	}
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
