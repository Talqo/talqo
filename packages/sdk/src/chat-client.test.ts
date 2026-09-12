import { describe, expect, test } from "bun:test"

import {
	createChatClient,
	MissingChatTransportError,
	type ChatConfiguration,
	type ChatEvent,
	type ChatTransport,
} from "./index"
import { createChatStorageKey, createMemoryStorage, readChatStorageRecord } from "./storage"

const configuration: ChatConfiguration = {
	title: "Support",
	appearance: { primary: "#123456" },
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function streamFrom(events: ChatEvent[]): AsyncIterable<ChatEvent> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event
		},
	}
}

function baseTransport(overrides: Partial<ChatTransport> = {}): ChatTransport {
	return {
		loadConfiguration: async () => configuration,
		loadSession: async () => ({ messages: [], activeGeneration: undefined }),
		recoverBootstrap: async () => ({ status: "not-accepted" }),
		sendMessage: async () => streamFrom([]),
		cancelResponse: async () => undefined,
		...overrides,
	}
}

describe("createChatClient", () => {
	test("constructs without side effects and reports a deliberately missing transport", async () => {
		let storageReads = 0
		let randomCalls = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage: {
				getItem: async () => {
					storageReads += 1
					return null
				},
				setItem: async () => undefined,
				removeItem: async () => undefined,
			},
			randomBytes: () => {
				randomCalls += 1
				return new Uint8Array(32)
			},
		})

		expect(storageReads).toBe(0)
		expect(randomCalls).toBe(0)
		await expect(client.initialize()).rejects.toBeInstanceOf(MissingChatTransportError)
	})

	test("initializes configuration and restores server history from a stored credential", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		await storage.setItem(key, JSON.stringify({ version: 1, credential: "credential" }))
		const transport = baseTransport({
			loadSession: async ({ credential }) => {
				expect(credential).toBe("credential")
				return {
					messages: [
						{ id: "u1", role: "user", text: "hello", createdAt: "2026-09-11T00:00:00Z", outcome: "completed" },
						{ id: "a1", role: "assistant", text: "hi", createdAt: "2026-09-11T00:00:01Z", outcome: "completed" },
					],
					activeGeneration: undefined,
				}
			},
		})
		const client = createChatClient({ apiUrl: "https://api.example.test", embedToken: "embed", storage, transport })
		const snapshots = [client.getSnapshot()]
		client.subscribe(() => snapshots.push(client.getSnapshot()))

		await client.initialize()

		expect(client.getSnapshot()).toMatchObject({ initialization: "ready", configuration, persistence: "persistent" })
		expect(client.getSnapshot().messages.map(({ id }) => id)).toEqual(["u1", "a1"])
		expect(snapshots.length).toBeGreaterThan(2)
		expect(Object.isFrozen(client.getSnapshot())).toBe(true)
		expect(Object.isFrozen(client.getSnapshot().messages)).toBe(true)
	})

	test("publishes optimistic and streamed messages, reconciles IDs, and persists the credential", async () => {
		const storage = createMemoryStorage()
		const transport = baseTransport({
			sendMessage: async () =>
				streamFrom([
					{
						type: "accepted",
						requestId: "server-request",
						credential: "credential",
						generationId: "generation",
						userMessage: { id: "server-user", createdAt: "2026-09-11T00:00:00Z" },
						assistantMessage: { id: "server-assistant", createdAt: "2026-09-11T00:00:01Z" },
					},
					{ type: "delta", assistantMessageId: "server-assistant", text: "Hel" },
					{ type: "delta", assistantMessageId: "server-assistant", text: "lo" },
					{ type: "terminal", outcome: "completed" },
				]),
		})
		let calls = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport,
			randomBytes: (length) => new Uint8Array(length).fill(++calls),
		})
		await client.initialize()
		const observed: string[][] = []
		client.subscribe(() => observed.push(client.getSnapshot().messages.map(({ text }) => text)))

		await client.sendMessage("hello")

		expect(observed).toContainEqual(["hello"])
		expect(observed).toContainEqual(["hello", "Hel"])
		expect(client.getSnapshot()).toMatchObject({ generation: "idle", error: undefined })
		expect(client.getSnapshot().messages).toMatchObject([
			{ id: "server-user", text: "hello", outcome: "completed" },
			{ id: "server-assistant", text: "Hello", outcome: "completed" },
		])
		const stored = readChatStorageRecord(
			await storage.getItem(createChatStorageKey("https://api.example.test", "embed")),
		)
		expect(stored).toEqual({ version: 1, credential: "credential" })
		expect(calls).toBe(2)
	})

	test("allows only one send and never regenerates after an uncertain transport failure", async () => {
		const pending = deferred<AsyncIterable<ChatEvent>>()
		let sends = 0
		const transport = baseTransport({
			sendMessage: () => {
				sends += 1
				return pending.promise
			},
		})
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport,
			randomBytes: (length) => new Uint8Array(length),
		})
		await client.initialize()
		const first = client.sendMessage("first")
		await expect(client.sendMessage("second")).rejects.toThrow("already active")
		pending.reject(new Error("connection lost"))
		await expect(first).rejects.toThrow("connection lost")

		expect(sends).toBe(1)
		expect(client.getSnapshot()).toMatchObject({ generation: "recovery", recovery: "pending" })
		expect(client.getSnapshot().messages[0]).toMatchObject({ text: "first", outcome: "interrupted" })
	})

	test("treats a stream that closes without a terminal event as recovery work", async () => {
		const recoveryStarted = deferred<void>()
		const recoveredSession = deferred<Awaited<ReturnType<ChatTransport["loadSession"]>>>()
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				loadSession: async () => {
					recoveryStarted.resolve()
					return recoveredSession.promise
				},
				sendMessage: async () =>
					streamFrom([
						{
							type: "accepted",
							requestId: "request",
							credential: "credential",
							generationId: "generation",
							userMessage: { id: "u1", createdAt: "now" },
							assistantMessage: { id: "a1", createdAt: "now" },
						},
					]),
			}),
			randomBytes: (length) => new Uint8Array(length),
			recoveryDelays: [0],
		})
		await client.initialize()

		await expect(client.sendMessage("hello")).rejects.toThrow("terminal event")
		expect(client.getSnapshot()).toMatchObject({ generation: "recovery", recovery: "pending" })
		expect(client.getSnapshot().messages[0]).toMatchObject({ outcome: "interrupted" })

		await recoveryStarted.promise
		const recoveryFinished = deferred<void>()
		const unsubscribe = client.subscribe(() => {
			if (client.getSnapshot().recovery === "idle") recoveryFinished.resolve()
		})
		recoveredSession.resolve({
			messages: [
				{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" },
				{ id: "a1", role: "assistant", text: "recovered", createdAt: "now", outcome: "completed" },
			],
			activeGeneration: undefined,
		})
		await recoveryFinished.promise
		unsubscribe()
		expect(client.getSnapshot()).toMatchObject({ generation: "idle", recovery: "idle" })
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "recovered", outcome: "completed" })
	})

	test("recovers a pending bootstrap on initialize and reloads accepted history", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		await storage.setItem(
			key,
			JSON.stringify({ version: 1, pending: { requestId: "request", bootstrapSecret: "bootstrap", text: "hello" } }),
		)
		let recovered = false
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				recoverBootstrap: async (input) => {
					expect(input).toMatchObject({ requestId: "request", bootstrapSecret: "bootstrap" })
					recovered = true
					return { status: "accepted", credential: "credential" }
				},
				loadSession: async () => ({
					messages: [{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" }],
					activeGeneration: undefined,
				}),
			}),
		})

		await client.initialize()

		expect(recovered).toBe(true)
		expect(client.getSnapshot().messages).toHaveLength(1)
		expect(readChatStorageRecord(await storage.getItem(key))).toEqual({ version: 1, credential: "credential" })
	})

	test("resubmits a not-accepted bootstrap with the same private identity", async () => {
		const storage = createMemoryStorage()
		const pending = { requestId: "request", bootstrapSecret: "bootstrap", text: "hello" }
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, pending }),
		)
		let sentInput: Parameters<ChatTransport["sendMessage"]>[0] | undefined
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				recoverBootstrap: async () => ({ status: "not-accepted" }),
				sendMessage: async (input) => {
					sentInput = input
					return streamFrom([
						{
							type: "accepted",
							requestId: "request",
							credential: "credential",
							generationId: "generation",
							userMessage: { id: "u1", createdAt: "now" },
							assistantMessage: { id: "a1", createdAt: "now" },
						},
						{ type: "terminal", outcome: "completed" },
					])
				},
			}),
			randomBytes: () => {
				throw new Error("must reuse pending bootstrap")
			},
		})

		await client.initialize()
		await client.sendMessage("hello")

		expect(sentInput).toMatchObject(pending)
	})

	test("uses the bootstrap capability to cancel before acceptance", async () => {
		const started = deferred<void>()
		let cancellation: Parameters<ChatTransport["cancelResponse"]>[0] | undefined
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					started.resolve()
					return {
						[Symbol.asyncIterator]() {
							return {
								next: () =>
									new Promise<IteratorResult<ChatEvent>>((_resolve, reject) => {
										signal.addEventListener("abort", () => reject(signal.reason), { once: true })
									}),
							}
						},
					}
				},
				cancelResponse: async (input) => {
					cancellation = input
				},
			}),
			randomBytes: (length) => new Uint8Array(length).fill(length),
		})
		await client.initialize()
		const sending = client.sendMessage("hello")
		await started.promise

		await client.cancelResponse()
		await expect(sending).rejects.toThrow("cancelled")

		expect(cancellation).toMatchObject({ requestId: expect.any(String), bootstrapSecret: expect.any(String) })
	})

	test("dispose aborts initialization transport work", async () => {
		const started = deferred<void>()
		let aborted = false
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				loadConfiguration: async ({ signal }) => {
					started.resolve()
					return new Promise<ChatConfiguration>((_resolve, reject) => {
						signal.addEventListener(
							"abort",
							() => {
								aborted = true
								reject(signal.reason)
							},
							{ once: true },
						)
					})
				},
			}),
		})
		const initializing = client.initialize()
		await started.promise

		client.dispose()

		await expect(initializing).rejects.toThrow("disposed")
		expect(aborted).toBe(true)
	})

	test("cancels active server work before a successful new-chat reset", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		await storage.setItem(key, JSON.stringify({ version: 1, credential: "credential" }))
		const order: string[] = []
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async () => ({
					messages: [{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" }],
					activeGeneration: { id: "generation" },
				}),
				cancelResponse: async () => {
					order.push("cancel")
				},
			}),
		})
		await client.initialize()

		await client.startNewChat()

		order.push("cleared")
		expect(order).toEqual(["cancel", "cleared"])
		expect(client.getSnapshot()).toMatchObject({ messages: [], generation: "idle", reset: "idle" })
		expect(await storage.getItem(key)).toBeNull()
	})

	test("keeps the conversation when cancellation makes reset fail", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: "credential" }),
		)
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async () => ({
					messages: [{ id: "u1", role: "user", text: "keep me", createdAt: "now", outcome: "completed" }],
					activeGeneration: { id: "generation" },
				}),
				cancelResponse: async () => {
					throw new Error("cancel failed")
				},
			}),
		})
		await client.initialize()

		await expect(client.startNewChat()).rejects.toThrow("cancel failed")
		expect(client.getSnapshot().messages[0]?.text).toBe("keep me")
		expect(client.getSnapshot()).toMatchObject({ reset: "idle", error: { code: "reset_failed" } })
	})

	test("surfaces storage fallback and disposal stops notifications and active work", async () => {
		let aborted = false
		let notifications = 0
		const pending = deferred<AsyncIterable<ChatEvent>>()
		const started = deferred<void>()
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage: {
				getItem: async () => {
					throw new Error("blocked")
				},
				setItem: async () => undefined,
				removeItem: async () => undefined,
			},
			transport: baseTransport({
				sendMessage: async (input) => {
					started.resolve()
					input.signal.addEventListener("abort", () => {
						aborted = true
						pending.reject(input.signal.reason)
					})
					return pending.promise
				},
			}),
			randomBytes: (length) => new Uint8Array(length),
		})
		client.subscribe(() => {
			notifications += 1
		})
		await client.initialize()
		expect(client.getSnapshot()).toMatchObject({ persistence: "memory", error: { code: "storage_unavailable" } })
		void client.sendMessage("hello").catch(() => undefined)
		await started.promise
		const beforeDispose = notifications

		client.dispose()

		expect(aborted).toBe(true)
		expect(notifications).toBe(beforeDispose)
		await expect(client.sendMessage("later")).rejects.toThrow("disposed")
	})
})
