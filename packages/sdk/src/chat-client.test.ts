import { describe, expect, spyOn, test } from "bun:test"

import {
	ChatTransportError,
	createChatClient,
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

async function waitForSnapshot(client: ReturnType<typeof createChatClient>, predicate: () => boolean): Promise<void> {
	if (predicate()) return
	await new Promise<void>((resolve) => {
		const unsubscribe = client.subscribe(() => {
			if (!predicate()) return
			unsubscribe()
			resolve()
		})
	})
}

function baseTransport(overrides: Partial<ChatTransport> = {}): ChatTransport {
	return {
		loadConfiguration: async () => configuration,
		loadSession: async () => ({ messages: [], activeGeneration: undefined }),
		sendMessage: async () => streamFrom([]),
		cancelResponse: async () => undefined,
		...overrides,
	}
}

describe("createChatClient", () => {
	test("stores a UUID bearer before the first send", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		const credential = "22222222-2222-4222-8222-222222222222"
		const requestId = "11111111-1111-4111-8111-111111111111"
		const values = [credential, requestId]
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				sendMessage: async (input) => {
					expect({ credential: input.credential, requestId: input.requestId, text: input.text }).toEqual({
						credential,
						requestId,
						text: "hello",
					})
					expect(readChatStorageRecord(await storage.getItem(key))).toEqual({
						version: 1,
						credential,
						pending: { requestId, text: "hello" },
					})
					return streamFrom([
						{
							type: "accepted",
							requestId: input.requestId,
							generationId: "generation",
							userMessage: { id: "user", createdAt: "now" },
							assistantMessage: { id: "assistant", createdAt: "now" },
						},
						{ type: "terminal", outcome: "completed" },
					])
				},
			}),
			randomUUID: () => values.shift()!,
		})
		await client.initialize()

		await client.sendMessage("hello")

		expect(readChatStorageRecord(await storage.getItem(key))).toEqual({
			version: 1,
			credential,
		})
	})

	test("constructs without side effects and uses the production transport by default", async () => {
		let storageReads = 0
		let randomCalls = 0
		using fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					version: 1,
					name: "Support",
					appearance: {
						light: {
							primary: "#111111",
							textOnPrimary: "#ffffff",
							background: "#ffffff",
							surface: "#eeeeee",
							text: "#111111",
						},
						dark: {
							primary: "#eeeeee",
							textOnPrimary: "#111111",
							background: "#111111",
							surface: "#222222",
							text: "#ffffff",
						},
						position: "bottom-right",
						theme: "system",
						themeToggle: true,
						language: "en",
					},
				}),
				{
					headers: { "Content-Type": "application/json" },
				},
			),
		)
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
			randomUUID: () => {
				randomCalls += 1
				return "11111111-1111-4111-8111-111111111111"
			},
		})

		expect(storageReads).toBe(0)
		expect(randomCalls).toBe(0)
		expect(fetchSpy).not.toHaveBeenCalled()
		await client.initialize()
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(client.getSnapshot().configuration?.title).toBe("Support")
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

	test("publishes optimistic and streamed messages and reconciles IDs", async () => {
		const storage = createMemoryStorage()
		const transport = baseTransport({
			sendMessage: async () =>
				streamFrom([
					{
						type: "accepted",
						requestId: "server-request",
						generationId: "generation",
						userMessage: { id: "server-user", createdAt: "2026-09-11T00:00:00Z" },
						assistantMessage: { id: "server-assistant", createdAt: "2026-09-11T00:00:01Z" },
					},
					{ type: "delta", assistantMessageId: "server-assistant", text: "Hel" },
					{ type: "delta", assistantMessageId: "server-assistant", text: "lo" },
					{ type: "terminal", outcome: "completed" },
				]),
		})
		const credential = "22222222-2222-4222-8222-222222222222"
		const requestId = "11111111-1111-4111-8111-111111111111"
		const values = [credential, requestId]
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport,
			randomUUID: () => values.shift()!,
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
		expect(stored).toEqual({ version: 1, credential })
		expect(values).toEqual([])
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
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
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

	test("clears a definitely rejected first session and permits a different send", async () => {
		const storage = createMemoryStorage()
		const rejection = new ChatTransportError({
			code: "chat-daily-allowance-exceeded",
			status: 429,
			retryAt: "2026-09-13T00:00:00.000Z",
		})
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					if (sends === 1) throw rejection
					return streamFrom([
						{
							type: "accepted",
							requestId: "second",
							generationId: "generation",
							userMessage: { id: "u2", createdAt: "now" },
							assistantMessage: { id: "a2", createdAt: "now" },
						},
						{ type: "terminal", outcome: "completed" },
					])
				},
			}),
			randomUUID: () => crypto.randomUUID(),
		})
		await client.initialize()

		await expect(client.sendMessage("rejected")).rejects.toBe(rejection)
		expect(client.getSnapshot()).toMatchObject({
			generation: "idle",
			recovery: "idle",
			error: rejection.detail,
			retryAt: rejection.detail.retryAt,
			messages: [],
		})
		expect(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))).toBeNull()
		await client.sendMessage("different")
		expect(sends).toBe(2)
	})

	test("polls an uncertain first session to completion without regenerating", async () => {
		const storage = createMemoryStorage()
		let loads = 0
		const sends: { credential: string; requestId: string; text: string }[] = []
		const credential = "22222222-2222-4222-8222-222222222222"
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				sendMessage: async (input) => {
					sends.push({ credential: input.credential, requestId: input.requestId, text: input.text })
					if (sends.length === 1) throw new Error("connection lost")
					return streamFrom([])
				},
				loadSession: async () => {
					loads += 1
					return loads === 1
						? {
								messages: [
									{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" as const },
									{ id: "a1", role: "assistant", text: "partial", createdAt: "now", outcome: "streaming" as const },
								],
								activeGeneration: { id: "generation" },
							}
						: {
								messages: [
									{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" as const },
									{ id: "a1", role: "assistant", text: "recovered", createdAt: "now", outcome: "completed" as const },
								],
								activeGeneration: undefined,
							}
				},
			}),
			randomUUID: (() => {
				const values = [credential, "11111111-1111-4111-8111-111111111111"]
				return () => values.shift()!
			})(),
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")

		expect(sends).toHaveLength(2)
		expect(sends[1]).toEqual(sends[0])
		expect(loads).toBe(2)
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "recovered", outcome: "completed" })
		expect(
			readChatStorageRecord(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))),
		).toEqual({
			version: 1,
			credential,
		})
	})

	test("confirms an uncertain established send before accepting an idle session", async () => {
		const storage = createMemoryStorage()
		const credential = "22222222-2222-4222-8222-222222222222"
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential }),
		)
		const sends: { credential: string; requestId: string; text: string }[] = []
		let loads = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async () => {
					loads += 1
					return { messages: [], activeGeneration: undefined }
				},
				sendMessage: async (input) => {
					sends.push({ credential: input.credential, requestId: input.requestId, text: input.text })
					if (sends.length === 1) throw new Error("connection lost")
					return streamFrom([])
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")

		await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")

		expect(loads).toBe(2)
		expect(sends).toHaveLength(2)
		expect(sends[1]).toEqual(sends[0])
	})

	test("continues session recovery when the first load fails", async () => {
		let loads = 0
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					if (sends === 1) throw new Error("connection lost")
					return streamFrom([])
				},
				loadSession: async () => {
					loads += 1
					if (loads === 1) throw new Error("session temporarily unavailable")
					return {
						messages: [
							{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" },
							{ id: "a1", role: "assistant", text: "recovered", createdAt: "now", outcome: "completed" },
						],
						activeGeneration: undefined,
					}
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")

		expect(loads).toBe(2)
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "recovered", outcome: "completed" })
	})

	test("keeps polling beyond the default generation timeout window", async () => {
		let loads = 0
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					if (sends === 1) throw new Error("connection lost")
					return streamFrom([])
				},
				loadSession: async () => {
					loads += 1
					return {
						messages: [],
						activeGeneration: loads <= 25 ? { id: "generation" } : undefined,
					}
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")

		await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")

		expect(loads).toBe(26)
	})

	for (const rejection of [
		new ChatTransportError({
			code: "internal-server-error",
			status: 503,
		}),
		new ChatTransportError({
			code: "invalid-response",
			status: 200,
		}),
	]) {
		test(`keeps status ${rejection.detail.status} pre-accept failures in uncertain recovery`, async () => {
			const client = createChatClient({
				apiUrl: "https://api.example.test",
				embedToken: "embed",
				transport: baseTransport({
					sendMessage: async () => {
						throw rejection
					},
					loadSession: async () => {
						throw rejection
					},
				}),
				randomUUID: () => "11111111-1111-4111-8111-111111111111",
				recoveryDelays: [0],
			})
			await client.initialize()
			await expect(client.sendMessage("hello")).rejects.toBe(rejection)
			await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")

			expect(client.getSnapshot()).toMatchObject({ generation: "recovery", recovery: "unavailable" })
			expect(client.getSnapshot().messages[0]).toMatchObject({ outcome: "interrupted" })
		})
	}

	test("bounds retries of the exact pending request", async () => {
		let loads = 0
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					throw new Error("connection lost")
				},
				loadSession: async () => {
					loads += 1
					throw new Error("not accepted")
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")

		expect(loads).toBe(0)
		await expect(client.sendMessage("hello")).rejects.toThrow("pending message")
		await expect(client.sendMessage("different")).rejects.toThrow("pending message")
		expect(sends).toBe(66)
	})

	test("stops recovery on a definitive pending-request rejection and exposes its details", async () => {
		const storage = createMemoryStorage()
		const rejection = new ChatTransportError({
			code: "chat-daily-allowance-exceeded",
			status: 429,
			retryAt: "2026-09-13T00:00:00.000Z",
		})
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					if (sends === 1) throw new Error("connection lost")
					throw rejection
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().generation === "idle")

		expect(sends).toBe(2)
		expect(client.getSnapshot()).toMatchObject({
			generation: "idle",
			recovery: "idle",
			error: rejection.detail,
			retryAt: rejection.detail.retryAt,
			messages: [],
		})
		const record = readChatStorageRecord(
			await storage.getItem(createChatStorageKey("https://api.example.test", "embed")),
		)
		expect(record).toEqual({ version: 1, credential: "11111111-1111-4111-8111-111111111111" })
	})

	for (const event of [
		{ type: "delta", assistantMessageId: "a1", text: "invalid" },
		{ type: "terminal", outcome: "completed" },
		{
			type: "error",
			outcome: "failed",
			error: { code: "provider-error", retriable: true, newChatAvailable: false },
		},
	] satisfies ChatEvent[]) {
		test(`rejects ${event.type} before acceptance without resolving pending optimistic state`, async () => {
			const client = createChatClient({
				apiUrl: "https://api.example.test",
				embedToken: "embed",
				transport: baseTransport({
					sendMessage: async () => streamFrom([event]),
					loadSession: async () => {
						throw new Error("not accepted")
					},
				}),
				randomUUID: () => "11111111-1111-4111-8111-111111111111",
				recoveryDelays: [0],
			})
			await client.initialize()
			await expect(client.sendMessage("hello")).rejects.toThrow("before acceptance")
			await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")
			expect(client.getSnapshot().messages).not.toContainEqual(expect.objectContaining({ outcome: "pending" }))
		})
	}

	test("recovers an established session after a protocol event arrives before acceptance", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: "credential" }),
		)
		let loads = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async () => {
					loads += 1
					return loads === 1
						? { messages: [], activeGeneration: undefined }
						: {
								messages: [{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" }],
								activeGeneration: undefined,
							}
				},
				sendMessage: async () => streamFrom([{ type: "terminal", outcome: "completed" }]),
			}),
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("before acceptance")
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")
		expect(client.getSnapshot().messages).toEqual([expect.objectContaining({ id: "u1", outcome: "completed" })])
	})

	test("clears transient error details as soon as an active generation is recovered", async () => {
		const recoveryStarted = deferred<void>()
		const recoveredSession = deferred<Awaited<ReturnType<ChatTransport["loadSession"]>>>()
		let loads = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				loadSession: async () => {
					loads += 1
					if (loads > 1) return new Promise<never>(() => undefined)
					recoveryStarted.resolve()
					return recoveredSession.promise
				},
				sendMessage: async () => ({
					async *[Symbol.asyncIterator]() {
						yield {
							type: "accepted" as const,
							requestId: "request",
							generationId: "generation",
							userMessage: { id: "u1", createdAt: "now" },
							assistantMessage: { id: "a1", createdAt: "now" },
						}
						throw new ChatTransportError({
							code: "transport-error",
							retryAt: "2026-09-13T00:00:00.000Z",
						})
					},
				}),
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()

		await expect(client.sendMessage("hello")).rejects.toThrow("transport-error")
		expect(client.getSnapshot()).toMatchObject({
			generation: "recovery",
			recovery: "pending",
			error: { code: "transport-error" },
			retryAt: "2026-09-13T00:00:00.000Z",
		})
		expect(client.getSnapshot().messages[0]).toMatchObject({ outcome: "completed" })
		expect(client.getSnapshot().messages[1]).toMatchObject({ outcome: "interrupted" })

		await recoveryStarted.promise
		const recoveryObserved = deferred<void>()
		const unsubscribe = client.subscribe(() => {
			if (client.getSnapshot().messages.at(-1)?.text === "recovered") recoveryObserved.resolve()
		})
		recoveredSession.resolve({
			messages: [
				{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" },
				{ id: "a1", role: "assistant", text: "recovered", createdAt: "now", outcome: "streaming" },
			],
			activeGeneration: { id: "generation" },
		})
		await recoveryObserved.promise
		unsubscribe()
		expect(client.getSnapshot()).toMatchObject({
			generation: "recovery",
			recovery: "pending",
			error: undefined,
			retryAt: undefined,
		})
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "recovered", outcome: "streaming" })
		client.dispose()
	})

	test("retries the latest retriable failed turn as a new attempt", async () => {
		const sent: string[] = []
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async ({ text }) => {
					sent.push(text)
					const suffix = sent.length
					return streamFrom([
						{
							type: "accepted",
							requestId: `request-${suffix}`,
							generationId: `generation-${suffix}`,
							userMessage: { id: `user-${suffix}`, createdAt: "now" },
							assistantMessage: { id: `assistant-${suffix}`, createdAt: "now" },
						},
						...(suffix === 1
							? ([
									{
										type: "error",
										outcome: "failed",
										error: { code: "provider-error", retriable: true, newChatAvailable: false },
									},
								] as const)
							: ([{ type: "terminal", outcome: "completed" }] as const)),
					])
				},
			}),
			randomUUID: (() => {
				const values = [
					"11111111-1111-4111-8111-111111111111",
					"22222222-2222-4222-8222-222222222222",
					"33333333-3333-4333-8333-333333333333",
				]
				return () => values.shift()!
			})(),
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("provider-error")

		await client.retryLastMessage()

		expect(sent).toEqual(["hello", "hello"])
		expect(client.getSnapshot()).toMatchObject({
			error: undefined,
			messages: [
				{ id: "user-1", outcome: "completed" },
				{ id: "assistant-1", outcome: "failed" },
				{ id: "user-2", outcome: "completed" },
				{ id: "assistant-2", outcome: "completed" },
			],
		})
	})

	test("keeps the accepted user completed when the stream fails", async () => {
		const recoveryStarted = deferred<void>()
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => ({
					async *[Symbol.asyncIterator]() {
						yield {
							type: "accepted" as const,
							requestId: "request",
							generationId: "generation",
							userMessage: { id: "u1", createdAt: "now" },
							assistantMessage: { id: "a1", createdAt: "now" },
						}
						throw new Error("stream failed")
					},
				}),
				loadSession: async () => {
					recoveryStarted.resolve()
					return new Promise<never>(() => undefined)
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()

		await expect(client.sendMessage("hello")).rejects.toThrow("stream failed")
		await recoveryStarted.promise
		expect(client.getSnapshot().messages).toMatchObject([
			{ id: "u1", outcome: "completed" },
			{ id: "a1", outcome: "interrupted" },
		])
		client.dispose()
	})

	test("stops accepted-session recovery on 401 without resubmitting", async () => {
		const rejection = new ChatTransportError({
			code: "chat-session-unauthorized",
			status: 401,
		})
		let sends = 0
		let loads = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					return {
						async *[Symbol.asyncIterator]() {
							yield {
								type: "accepted" as const,
								requestId: "request",
								generationId: "generation",
								userMessage: { id: "u1", createdAt: "now" },
								assistantMessage: { id: "a1", createdAt: "now" },
							}
							throw new Error("stream failed")
						},
					}
				},
				loadSession: async () => {
					loads += 1
					throw rejection
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("stream failed")
		await waitForSnapshot(client, () => client.getSnapshot().generation === "idle")

		expect({ sends, loads }).toEqual({ sends: 1, loads: 1 })
		expect(client.getSnapshot()).toMatchObject({
			generation: "idle",
			recovery: "idle",
			error: rejection.detail,
			messages: [
				{ id: "u1", outcome: "completed" },
				{ id: "a1", outcome: "interrupted" },
			],
		})
	})

	test("recovers a pending first message on initialize", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		const credential = "22222222-2222-4222-8222-222222222222"
		await storage.setItem(
			key,
			JSON.stringify({ version: 1, credential, pending: { requestId: "request", text: "hello" } }),
		)
		let loads = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async (input) => {
					expect(input.credential).toBe(credential)
					loads += 1
					return {
						messages: [{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" }],
						activeGeneration: undefined,
					}
				},
			}),
		})

		await client.initialize()
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")

		expect(loads).toBe(1)
		expect(client.getSnapshot().messages).toHaveLength(1)
		expect(readChatStorageRecord(await storage.getItem(key))).toEqual({ version: 1, credential })
	})

	test("resubmits a stored pending message with its original identity", async () => {
		const storage = createMemoryStorage()
		const pending = { requestId: "request", text: "hello" }
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: "credential", pending }),
		)
		let loads = 0
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async (input) => {
					expect(input.credential).toBe("credential")
					loads += 1
					throw new Error("not accepted")
				},
				sendMessage: async () => {
					sends += 1
					return streamFrom([])
				},
			}),
			recoveryDelays: [0],
		})

		await client.initialize()
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")
		await expect(client.sendMessage("hello")).rejects.toThrow("already active")

		expect(loads).toBe(65)
		expect(sends).toBe(1)
	})

	test("uses the stored bearer to cancel before acceptance", async () => {
		const started = deferred<void>()
		const storage = createMemoryStorage()
		let cancellation: Parameters<ChatTransport["cancelResponse"]>[0] | undefined
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					started.resolve()
					return {
						[Symbol.asyncIterator]() {
							return {
								next: () =>
									new Promise<IteratorResult<ChatEvent>>((_resolve, reject) => {
										if (signal.aborted) {
											reject(signal.reason)
											return
										}
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
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
		})
		await client.initialize()
		const sending = client.sendMessage("hello")
		await started.promise

		await client.cancelResponse()
		await expect(sending).rejects.toThrow("cancelled")

		expect(cancellation).toMatchObject({ credential: "11111111-1111-4111-8111-111111111111" })
		expect(client.getSnapshot()).toMatchObject({
			generation: "idle",
			messages: [{ outcome: "interrupted" }],
		})
		expect(
			readChatStorageRecord(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))),
		).toEqual({ version: 1, credential: "11111111-1111-4111-8111-111111111111" })
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

	test("rejects retry while a new-chat reset owns the session state", async () => {
		const memory = createMemoryStorage()
		const removal = deferred<void>()
		let blockRemoval = false
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage: {
				getItem: (key) => memory.getItem(key),
				setItem: (key, value) => memory.setItem(key, value),
				async removeItem(key) {
					if (blockRemoval) await removal.promise
					await memory.removeItem(key)
				},
			},
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					return streamFrom([
						{
							type: "accepted",
							requestId: "request",
							generationId: "generation",
							userMessage: { id: "user", createdAt: "now" },
							assistantMessage: { id: "assistant", createdAt: "now" },
						},
						{
							type: "error",
							outcome: "failed",
							error: { code: "provider-error", retriable: true, newChatAvailable: false },
						},
					])
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("provider-error")
		blockRemoval = true

		const resetting = client.startNewChat()
		await expect(client.retryLastMessage()).rejects.toThrow("resetting")

		expect(sends).toBe(1)
		removal.resolve()
		await resetting
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
		expect(client.getSnapshot()).toMatchObject({ reset: "idle", error: { code: "reset-failed" } })
	})

	test("starts a new chat from a revoked-session initialization error using loaded configuration", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		await storage.setItem(key, JSON.stringify({ version: 1, credential: "revoked" }))
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async () => {
					throw new ChatTransportError({
						code: "chat-session-unauthorized",
						status: 401,
					})
				},
			}),
		})

		await expect(client.initialize()).rejects.toThrow("chat-session-unauthorized")
		expect(client.getSnapshot()).toMatchObject({ initialization: "error", configuration })
		await client.startNewChat()

		expect(client.getSnapshot()).toMatchObject({
			initialization: "ready",
			configuration,
			messages: [],
			error: undefined,
		})
		expect(await storage.getItem(key)).toBeNull()
	})

	test("fails reset without clearing state when persistent credential deletion falls back", async () => {
		const key = createChatStorageKey("https://api.example.test", "embed")
		let persisted = JSON.stringify({ version: 1, credential: "credential" })
		let sentCredential: string | undefined
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage: {
				getItem: async () => persisted,
				setItem: async (_key, value) => {
					persisted = value
				},
				removeItem: async () => {
					throw new Error("deletion blocked")
				},
			},
			transport: baseTransport({
				loadSession: async () => ({
					messages: [{ id: "u1", role: "user", text: "keep me", createdAt: "now", outcome: "completed" }],
					activeGeneration: undefined,
				}),
				sendMessage: async (input) => {
					sentCredential = input.credential
					return streamFrom([
						{
							type: "accepted",
							requestId: "request",
							generationId: "generation",
							userMessage: { id: "u2", createdAt: "now" },
							assistantMessage: { id: "a2", createdAt: "now" },
						},
						{ type: "terminal", outcome: "completed" },
					])
				},
			}),
		})
		await client.initialize()

		await expect(client.startNewChat()).rejects.toThrow("Persistent chat credential")

		expect(client.getSnapshot()).toMatchObject({
			messages: [expect.objectContaining({ text: "keep me" })],
			error: { code: "reset-failed" },
			persistence: "memory",
		})
		expect(readChatStorageRecord(persisted)).toEqual({ version: 1, credential: "credential" })
		expect(key).toContain("talqo:chat:v1")
		await client.sendMessage("still usable")
		expect(sentCredential).toBe("credential")
	})

	test("aborts a pre-accept send when server cancellation is not yet authorized", async () => {
		const sendStarted = deferred<void>()
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					sends += 1
					if (sends > 1) throw new Error("not accepted")
					sendStarted.resolve()
					return {
						[Symbol.asyncIterator]: () => ({
							next: () =>
								new Promise<IteratorResult<ChatEvent>>((_resolve, reject) => {
									if (signal.aborted) {
										reject(signal.reason)
										return
									}
									signal.addEventListener("abort", () => reject(signal.reason), { once: true })
								}),
						}),
					}
				},
				cancelResponse: async () => {
					throw new ChatTransportError({
						code: "chat-session-unauthorized",
						status: 401,
					})
				},
				loadSession: async () => {
					throw new Error("not accepted")
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		const sending = client.sendMessage("hello")
		await sendStarted.promise
		await client.cancelResponse()
		await expect(sending).rejects.toThrow("cancelled")

		await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")
		expect(client.getSnapshot()).toMatchObject({ generation: "recovery", recovery: "unavailable" })
	})

	for (const sendSettlesFirst of [true, false]) {
		test(`recovers a persisted pre-accept request when cancellation fails ${sendSettlesFirst ? "after" : "before"} send abort`, async () => {
			const storage = createMemoryStorage()
			const sendStarted = deferred<void>()
			const cancellationStarted = deferred<void>()
			const cancellation = deferred<void>()
			let sends = 0
			const client = createChatClient({
				apiUrl: "https://api.example.test",
				embedToken: "embed",
				storage,
				transport: baseTransport({
					sendMessage: async ({ signal }) => {
						sends += 1
						if (sends > 1) return streamFrom([])
						sendStarted.resolve()
						return {
							[Symbol.asyncIterator]: () => ({
								next: () =>
									new Promise<IteratorResult<ChatEvent>>((_resolve, reject) => {
										if (signal.aborted) {
											reject(signal.reason)
											return
										}
										signal.addEventListener("abort", () => reject(signal.reason), { once: true })
									}),
							}),
						}
					},
					cancelResponse: async () => {
						cancellationStarted.resolve()
						await cancellation.promise
					},
					loadSession: async () => ({
						messages: [{ id: "u1", role: "user", text: "hello", createdAt: "now", outcome: "completed" }],
						activeGeneration: undefined,
					}),
				}),
				randomUUID: () => "11111111-1111-4111-8111-111111111111",
				recoveryDelays: [0],
			})
			await client.initialize()
			const sending = client.sendMessage("hello")
			const sendingRejection = sending.catch((cause: unknown) => cause)
			await sendStarted.promise
			const cancelling = client.cancelResponse()
			await cancellationStarted.promise
			if (sendSettlesFirst) expect(await sendingRejection).toBeInstanceOf(Error)
			cancellation.reject(new Error("cancel failed"))
			await expect(cancelling).rejects.toThrow("cancel failed")
			if (!sendSettlesFirst) expect(await sendingRejection).toBeInstanceOf(Error)
			await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")

			expect(sends).toBe(2)
			expect(client.getSnapshot()).toMatchObject({
				generation: "idle",
				recovery: "idle",
				messages: [{ id: "u1", outcome: "completed" }],
			})
			expect(
				readChatStorageRecord(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))),
			).toEqual({ version: 1, credential: "11111111-1111-4111-8111-111111111111" })
		})
	}

	test("confirms cancellation only after the server request succeeds", async () => {
		const accepted = deferred<void>()
		const cancellationStarted = deferred<void>()
		const cancellation = deferred<void>()
		let sendAborted = false
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				async sendMessage({ signal }) {
					return {
						async *[Symbol.asyncIterator]() {
							yield {
								type: "accepted" as const,
								requestId: "request",
								generationId: "generation",
								userMessage: { id: "u1", createdAt: "now" },
								assistantMessage: { id: "a1", createdAt: "now" },
							}
							accepted.resolve()
							await new Promise<void>((_resolve, reject) => {
								signal.addEventListener(
									"abort",
									() => {
										sendAborted = true
										reject(signal.reason)
									},
									{ once: true },
								)
							})
						},
					}
				},
				cancelResponse: async () => {
					cancellationStarted.resolve()
					await cancellation.promise
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
		})
		await client.initialize()
		const sending = client.sendMessage("hello")
		await accepted.promise
		const cancelling = client.cancelResponse()
		await cancellationStarted.promise

		expect(client.getSnapshot().generation).toBe("cancelling")
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ outcome: "streaming" })
		expect(sendAborted).toBe(false)
		cancellation.resolve()
		await cancelling
		await expect(sending).rejects.toThrow("cancelled")
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ outcome: "cancelled" })
	})

	test("deduplicates cancellation and dispose aborts cancellation transport work", async () => {
		const cancellationStarted = deferred<void>()
		const sendStarted = deferred<void>()
		let cancellationCalls = 0
		let cancellationAborted = false
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					sendStarted.resolve()
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
				cancelResponse: async ({ signal }) => {
					cancellationCalls += 1
					cancellationStarted.resolve()
					return new Promise<void>((_resolve, reject) => {
						signal.addEventListener(
							"abort",
							() => {
								cancellationAborted = true
								reject(signal.reason)
							},
							{ once: true },
						)
					})
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
		})
		await client.initialize()
		void client.sendMessage("hello").catch(() => undefined)
		await sendStarted.promise
		const first = client.cancelResponse()
		const second = client.cancelResponse()
		await cancellationStarted.promise

		expect(cancellationCalls).toBe(1)
		client.dispose()
		await expect(first).rejects.toThrow("disposed")
		await expect(second).rejects.toThrow("disposed")
		expect(cancellationAborted).toBe(true)
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
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
		})
		client.subscribe(() => {
			notifications += 1
		})
		await client.initialize()
		expect(client.getSnapshot()).toMatchObject({ persistence: "memory", error: { code: "storage-unavailable" } })
		void client.sendMessage("hello").catch(() => undefined)
		await started.promise
		const beforeDispose = notifications

		client.dispose()

		expect(aborted).toBe(true)
		expect(notifications).toBe(beforeDispose)
		await expect(client.sendMessage("later")).rejects.toThrow("disposed")
	})
})
