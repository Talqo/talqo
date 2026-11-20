import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test"

import {
	type ChatClient,
	ChatClientError,
	type ChatClientOptions,
	type ChatConfiguration,
	type ChatEvent,
	type ChatMessage,
	type ChatTransport,
	ChatTransportError,
	createChatClient,
	type SessionState,
} from "./index"
import { createChatStorageKey, createMemoryStorage, readChatStorageRecord } from "./storage"

// These tests exercise the in-memory fallback and leave no records behind. A DOM
// suite registered earlier in the process supplies one shared localStorage, which
// would leak a credential or pending message from one test into the next; the
// default-localStorage path has its own test.
let ambientLocalStorage: PropertyDescriptor | undefined
beforeAll(() => {
	ambientLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
	Reflect.deleteProperty(globalThis, "localStorage")
})
afterAll(() => {
	if (ambientLocalStorage) Object.defineProperty(globalThis, "localStorage", ambientLocalStorage)
})

const configuration: ChatConfiguration = {
	title: "Support",
	appearance: { primary: "#123456" },
	isAvailable: true,
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

function streamFrom(events: Array<ChatEvent>): AsyncIterable<ChatEvent> {
	return {
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event
		},
	}
}

function abortableStream(signal: AbortSignal): AsyncIterable<ChatEvent> {
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

function dailyAllowanceRejection(): ChatTransportError {
	return new ChatTransportError({
		code: "chat-daily-allowance-exceeded",
		status: 429,
		retryAt: "2026-09-13T00:00:00.000Z",
	})
}

function recoveryClient(loadSession: (loads: number) => Promise<Awaited<ReturnType<ChatTransport["loadSession"]>>>) {
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
				return loadSession(loads)
			},
		}),
		randomUUID: () => "11111111-1111-4111-8111-111111111111",
		recoveryDelays: [0],
	})
	return { client, loads: () => loads }
}

const CREDENTIAL = "22222222-2222-4222-8222-222222222222"

function acceptedEvent(generationId: string, ids: { user?: string; assistant?: string } = {}): ChatEvent {
	return {
		type: "accepted",
		requestId: generationId,
		generationId,
		userMessage: { id: ids.user ?? "u1", createdAt: "now" },
		assistantMessage: { id: ids.assistant ?? "a1", createdAt: "now" },
	}
}

function testClient(overrides: Partial<ChatClientOptions> = {}): ChatClient {
	return createChatClient({
		apiUrl: "https://api.example.test",
		embedToken: "embed",
		storage: createMemoryStorage(),
		transport: baseTransport(),
		randomUUID: () => CREDENTIAL,
		...overrides,
	})
}

function unresolvedSession(): Promise<SessionState> {
	return new Promise<SessionState>(() => {})
}

const cancellationFailures = [
	{
		name: "a non-transport failure",
		failure: new Error("cancel failed"),
		error: { code: "cancel-failed" },
	},
	{
		name: "a transport failure",
		failure: new ChatTransportError({ code: "internal-server-error", status: 500 }),
		error: { code: "internal-server-error", status: 500 },
	},
] as const

function recoveredTranscript(outcome: "completed" | "streaming"): ChatMessage[] {
	return [
		{
			id: "u1",
			role: "user",
			text: "hello",
			parts: [{ type: "text", text: "hello" }],
			createdAt: "now",
			outcome: "completed",
		},
		{
			id: "a1",
			role: "assistant",
			text: "recovered",
			parts: [{ type: "text", text: "recovered" }],
			createdAt: "now",
			outcome,
		},
	]
}

function toolPart(
	toolCallId: string,
	serverName: string,
	displayName: string,
	state: "input-available" | "output-available",
) {
	return {
		type: "dynamic-tool" as const,
		toolName: `${serverName}_${displayName}`,
		toolCallId,
		input: {},
		state,
		toolMetadata: {
			source: "mcp" as const,
			serverName,
			displayName,
			...(state === "output-available" ? { outcome: "completed" as const } : {}),
		},
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
					isAvailable: true,
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
						{
							id: "u1",
							role: "user",
							text: "hello",
							parts: [{ type: "text", text: "hello" }],
							createdAt: "2026-09-11T00:00:00Z",
							outcome: "completed",
						},
						{
							id: "a1",
							role: "assistant",
							text: "hi",
							parts: [{ type: "text", text: "hi" }],
							createdAt: "2026-09-11T00:00:01Z",
							outcome: "completed",
						},
					],
					activeGeneration: undefined,
				}
			},
		})
		const client = createChatClient({ apiUrl: "https://api.example.test", embedToken: "embed", storage, transport })

		expect(client.getSnapshot().isAvailable).toBe(false)
		expect(client.getSnapshot().actions).toEqual([])
		await client.initialize()

		expect(client.getSnapshot()).toMatchObject({
			isAvailable: true,
			activity: "idle",
			configuration,
			notices: [],
			actions: ["send", "new-chat"],
		})
		expect(client.getSnapshot().messages.map(({ id }) => id)).toEqual(["u1", "a1"])
	})

	test("keeps failed configuration unavailable without losing diagnostics", async () => {
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				loadConfiguration: async () => {
					throw new Error("offline")
				},
			}),
		})
		await expect(client.initialize()).rejects.toThrow("offline")
		expect(client.getSnapshot()).toMatchObject({
			isAvailable: false,
			activity: "blocked",
			error: { code: "transport-error" },
		})
	})

	test("never opens a session when the configuration is unavailable", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		await storage.setItem(key, JSON.stringify({ version: 1, credential: "credential" }))
		let sessionLoads = 0
		const transport = baseTransport({
			loadConfiguration: async () => ({ ...configuration, isAvailable: false }),
			loadSession: async () => {
				sessionLoads += 1
				return { messages: [], activeGeneration: undefined }
			},
		})
		const client = createChatClient({ apiUrl: "https://api.example.test", embedToken: "embed", storage, transport })

		await client.initialize()

		expect(client.getSnapshot()).toMatchObject({
			isAvailable: false,
			activity: "idle",
			configuration: { ...configuration, isAvailable: false },
			actions: [],
		})
		expect(client.getSnapshot().messages).toEqual([])
		expect(sessionLoads).toBe(0)
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
					{ type: "part", assistantMessageId: "server-assistant", index: 0, part: { type: "text", text: "" } },
					{ type: "delta", assistantMessageId: "server-assistant", index: 0, text: "Hel" },
					{ type: "delta", assistantMessageId: "server-assistant", index: 0, text: "lo" },
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
		const observed: Array<Array<string>> = []
		client.subscribe(() => observed.push(client.getSnapshot().messages.map(({ text }) => text)))

		await client.sendMessage("hello")

		expect(observed).toContainEqual(["hello"])
		expect(observed).toContainEqual(["hello", "Hel"])
		expect(client.getSnapshot()).toMatchObject({ activity: "idle", error: undefined })
		expect(client.getSnapshot().acceptedMessageId).toBe("server-user")
		expect(client.getSnapshot().messages).toMatchObject([
			{ id: "server-user", text: "hello", outcome: "completed" },
			{ id: "server-assistant", text: "Hello", outcome: "completed" },
		])
		const stored = readChatStorageRecord(
			await storage.getItem(createChatStorageKey("https://api.example.test", "embed")),
		)
		expect(stored).toEqual({ version: 1, credential })
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
		expect(client.getSnapshot()).toMatchObject({ activity: "sending", actions: ["stop", "new-chat"] })
		await expect(client.sendMessage("second")).rejects.toThrow("already active")
		pending.reject(new Error("connection lost"))
		await expect(first).rejects.toThrow("connection lost")

		expect(sends).toBe(1)
		expect(client.getSnapshot()).toMatchObject({ activity: "recovering" })
		expect(client.getSnapshot().actions).toEqual(["stop", "new-chat"])
		expect(client.getSnapshot().messages[0]).toMatchObject({ text: "first", outcome: "interrupted" })
	})

	test("cancelling during initial persistence leaves no send or session to restore", async () => {
		const memory = createMemoryStorage()
		const write = deferred<void>()
		let firstWrite = true
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage: {
				...memory,
				async setItem(key, value) {
					if (firstWrite) {
						firstWrite = false
						await write.promise
					}
					await memory.setItem(key, value)
				},
			},
			transport: baseTransport({
				cancelResponse: async () => {
					throw new ChatTransportError({ code: "chat-session-unauthorized", status: 401 })
				},
				sendMessage: async ({ signal }) => {
					sends += 1
					signal.throwIfAborted()
					return streamFrom([])
				},
			}),
		})
		await client.initialize()
		const sending = client.sendMessage("hello").catch((cause: unknown) => cause)
		const stopping = client.cancelResponse()
		write.resolve()
		await stopping
		expect(await sending).toBeInstanceOf(Error)
		expect(client.getSnapshot()).toMatchObject({ activity: "idle", messages: [], actions: ["send", "new-chat"] })
		expect(sends).toBe(0)
		expect(await memory.getItem(createChatStorageKey("https://api.example.test", "embed"))).toBeNull()
	})

	test("clears a definitely rejected first session and permits a different send", async () => {
		const storage = createMemoryStorage()
		const rejection = dailyAllowanceRejection()
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
			isAvailable: true,
			activity: "idle",
			error: rejection.detail,
			messages: [],
		})
		expect(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))).toBeNull()
		await client.sendMessage("different")
		expect(sends).toBe(2)
	})

	test("treats a pre-acceptance provider-error as a definite rejection instead of recovering", async () => {
		const rejection = new ChatTransportError({ code: "provider-error", status: 502 })
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					throw rejection
				},
			}),
			randomUUID: () => crypto.randomUUID(),
			recoveryDelays: [0],
		})
		await client.initialize()

		await expect(client.sendMessage("hey")).rejects.toBe(rejection)
		expect(client.getSnapshot()).toMatchObject({
			activity: "idle",
			error: rejection.detail,
			messages: [],
		})
		expect(sends).toBe(1)
	})

	test("refuses to send while the chat is unavailable", async () => {
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				loadConfiguration: async () => ({ ...configuration, isAvailable: false }),
				sendMessage: async () => {
					sends += 1
					return streamFrom([])
				},
			}),
		})
		await client.initialize()

		const refusal = await client.sendMessage("hey").catch((error: unknown) => error)
		expect(refusal).toBeInstanceOf(ChatClientError)
		expect(refusal).toMatchObject({ detail: { code: "chat-unavailable" } })
		expect(client.getSnapshot()).toMatchObject({ activity: "idle", messages: [] })
		expect(sends).toBe(0)
	})

	test("polls an uncertain first session to completion without regenerating", async () => {
		const storage = createMemoryStorage()
		let loads = 0
		const sends: Array<{ credential: string; requestId: string; text: string }> = []
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
									{
										id: "u1",
										role: "user",
										text: "hello",
										parts: [{ type: "text" as const, text: "hello" }],
										createdAt: "now",
										outcome: "completed" as const,
									},
									{
										id: "a1",
										role: "assistant",
										text: "partial",
										parts: [{ type: "text" as const, text: "partial" }],
										createdAt: "now",
										outcome: "streaming" as const,
									},
								],
								activeGeneration: { id: "generation" },
							}
						: {
								messages: [
									{
										id: "u1",
										role: "user",
										text: "hello",
										parts: [{ type: "text" as const, text: "hello" }],
										createdAt: "now",
										outcome: "completed" as const,
									},
									{
										id: "a1",
										role: "assistant",
										text: "recovered",
										parts: [{ type: "text" as const, text: "recovered" }],
										createdAt: "now",
										outcome: "completed" as const,
									},
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
		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

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
		const sends: Array<{ credential: string; requestId: string; text: string }> = []
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

		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

		expect(loads).toBe(2)
		expect(sends).toHaveLength(2)
		expect(sends[1]).toEqual(sends[0])
	})

	test("continues session recovery when the first load fails", async () => {
		const { client, loads } = recoveryClient(async (count) => {
			if (count === 1) throw new Error("session temporarily unavailable")
			return {
				messages: recoveredTranscript("completed"),
				activeGeneration: undefined,
			}
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

		expect(loads()).toBe(2)
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "recovered", outcome: "completed" })
	})

	test("keeps polling beyond the default generation timeout window", async () => {
		const { client, loads } = recoveryClient(async (count) => ({
			messages: [],
			activeGeneration: count <= 25 ? { id: "generation" } : undefined,
		}))
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")

		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

		expect(loads()).toBe(26)
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
			await waitForSnapshot(client, () => client.getSnapshot().notices.includes("recovery-unavailable"))

			expect(client.getSnapshot().activity).toBe("blocked")
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
		await waitForSnapshot(client, () => client.getSnapshot().notices.includes("recovery-unavailable"))

		expect(loads).toBe(0)
		await expect(client.sendMessage("hello")).rejects.toThrow("pending message")
		await expect(client.sendMessage("different")).rejects.toThrow("pending message")
		expect(sends).toBe(66)
	})

	test("stops recovery on a definitive pending-request rejection and exposes its details", async () => {
		const storage = createMemoryStorage()
		const rejection = dailyAllowanceRejection()
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
		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

		expect(sends).toBe(2)
		expect(client.getSnapshot()).toMatchObject({
			activity: "idle",
			error: rejection.detail,
			messages: [],
		})
		expect(client.getSnapshot().actions).toEqual(["send", "new-chat"])
		const record = readChatStorageRecord(
			await storage.getItem(createChatStorageKey("https://api.example.test", "embed")),
		)
		expect(record).toEqual({ version: 1, credential: "11111111-1111-4111-8111-111111111111" })
	})

	test("rejects a delta before acceptance without resolving pending optimistic state", async () => {
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => streamFrom([{ type: "delta", assistantMessageId: "a1", index: 0, text: "invalid" }]),
				loadSession: async () => {
					throw new Error("not accepted")
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("before acceptance")
		await waitForSnapshot(client, () => client.getSnapshot().notices.includes("recovery-unavailable"))
		expect(client.getSnapshot().messages).not.toContainEqual(expect.objectContaining({ outcome: "pending" }))
	})

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
								messages: [
									{
										id: "u1",
										role: "user",
										text: "hello",
										parts: [{ type: "text", text: "hello" }],
										createdAt: "now",
										outcome: "completed",
									},
								],
								activeGeneration: undefined,
							}
				},
				sendMessage: async () => streamFrom([{ type: "terminal", outcome: "completed" }]),
			}),
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("before acceptance")
		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")
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
					if (loads > 1) return new Promise<never>(() => {})
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
			activity: "recovering",
			error: { code: "transport-error", retryAt: "2026-09-13T00:00:00.000Z" },
		})
		expect(client.getSnapshot().messages[0]).toMatchObject({ outcome: "completed" })
		expect(client.getSnapshot().messages[1]).toMatchObject({ outcome: "interrupted" })

		await recoveryStarted.promise
		const recoveryObserved = deferred<void>()
		const unsubscribe = client.subscribe(() => {
			if (client.getSnapshot().messages.at(-1)?.text === "recovered") recoveryObserved.resolve()
		})
		recoveredSession.resolve({
			messages: recoveredTranscript("streaming"),
			activeGeneration: { id: "generation" },
		})
		await recoveryObserved.promise
		unsubscribe()
		expect(client.getSnapshot()).toMatchObject({
			activity: "recovering",
			error: undefined,
		})
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "recovered", outcome: "streaming" })
		client.dispose()
	})

	test("retries the latest retriable failed turn as a new attempt", async () => {
		const sent: Array<string> = []
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

		expect(client.getSnapshot().actions).toEqual(["send", "retry", "new-chat"])
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

	// Without an explicit branch, tool events fall into the terminal case and end every stream early.
	test("treats tool activity as progress rather than the end of the stream", async () => {
		const observed: Array<Array<string>> = []
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () =>
					streamFrom([
						{
							type: "accepted",
							requestId: "request",
							generationId: "generation",
							userMessage: { id: "u1", createdAt: "now" },
							assistantMessage: { id: "a1", createdAt: "now" },
						},
						{
							type: "part",
							assistantMessageId: "a1",
							index: 0,
							part: {
								type: "dynamic-tool",
								toolCallId: "first",
								toolName: "shopify_get_product",
								input: {},
								state: "input-available",
								toolMetadata: { source: "mcp", displayName: "get_product", serverName: "Shopify" },
							},
						},
						{
							type: "part",
							assistantMessageId: "a1",
							index: 1,
							part: {
								type: "dynamic-tool",
								toolCallId: "second",
								toolName: "shopify_get_product",
								input: {},
								state: "input-available",
								toolMetadata: { source: "mcp", displayName: "get_product", serverName: "Shopify" },
							},
						},
						{ type: "part", assistantMessageId: "a1", index: 2, part: { type: "text", text: "" } },
						{ type: "delta", assistantMessageId: "a1", index: 2, text: "Checking" },
						{
							type: "part",
							assistantMessageId: "a1",
							index: 0,
							part: {
								type: "dynamic-tool",
								toolCallId: "first",
								toolName: "shopify_get_product",
								input: {},
								output: { stock: 1 },
								state: "output-available",
								toolMetadata: { source: "mcp", displayName: "get_product", serverName: "Shopify" },
							},
						},
						{
							type: "part",
							assistantMessageId: "a1",
							index: 1,
							part: {
								type: "dynamic-tool",
								toolCallId: "second",
								toolName: "shopify_get_product",
								input: {},
								output: { stock: 2 },
								state: "output-available",
								toolMetadata: { source: "mcp", displayName: "get_product", serverName: "Shopify" },
							},
						},
						{ type: "part", assistantMessageId: "a1", index: 3, part: { type: "step-start" } },
						{ type: "part", assistantMessageId: "a1", index: 4, part: { type: "text", text: "!" } },
						{ type: "delta", assistantMessageId: "a1", index: 2, text: " stock" },
						{ type: "terminal", outcome: "completed" },
					]),
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
		})
		await client.initialize()
		client.subscribe(() => observed.push(client.getSnapshot().activeTools.map(({ toolName }) => toolName)))

		await client.sendMessage("is it in stock?")

		expect(observed).toContainEqual(["get_product"])
		expect(observed).toContainEqual(["get_product", "get_product"])
		expect(observed).toContainEqual([])
		expect(client.getSnapshot().messages).toMatchObject([
			{ id: "u1", outcome: "completed" },
			{ id: "a1", text: "Checking stock!", outcome: "completed" },
		])
		expect(client.getSnapshot().activeTools).toEqual([])
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
					return new Promise<never>(() => {})
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
		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

		expect({ sends, loads }).toEqual({ sends: 1, loads: 1 })
		expect(client.getSnapshot()).toMatchObject({
			activity: "idle",
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
						messages: [
							{
								id: "u1",
								role: "user",
								text: "hello",
								parts: [{ type: "text", text: "hello" }],
								createdAt: "now",
								outcome: "completed",
							},
						],
						activeGeneration: undefined,
					}
				},
			}),
		})

		await client.initialize()
		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

		expect(loads).toBe(1)
		expect(client.getSnapshot().messages).toHaveLength(1)
		expect(readChatStorageRecord(await storage.getItem(key))).toEqual({ version: 1, credential })
	})

	test("restores an interrupted website action without resending it or offering retry", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		await storage.setItem(
			key,
			JSON.stringify({
				version: 1,
				credential: "credential",
				pending: { requestId: "request", text: "Update the page", clientTools: true },
			}),
		)
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			recoveryDelays: [0],
			transport: baseTransport({
				sendMessage: async () => {
					sends++
					throw new Error("Website actions must not be resubmitted")
				},
				loadSession: async () => ({
					messages: [
						{
							id: "u1",
							requestId: "request",
							role: "user",
							text: "Update the page",
							parts: [{ type: "text", text: "Update the page" }],
							createdAt: "now",
							outcome: "completed",
						},
						{
							id: "a1",
							requestId: "request",
							role: "assistant",
							text: "",
							parts: [
								{
									type: "dynamic-tool",
									toolCallId: "action",
									toolName: "updatePage",
									input: {},
									state: "output-error",
									errorText: "Interrupted",
									toolMetadata: { source: "client", displayName: "updatePage", outcome: "interrupted" },
								},
							],
							createdAt: "now",
							outcome: "interrupted",
						},
					],
					activeGeneration: undefined,
				}),
			}),
		})
		try {
			await client.initialize()
			await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")
			expect(sends).toBe(0)
			expect(client.getSnapshot().error).toMatchObject({ code: "website-action-uncertain", retriable: false })
			expect(client.getSnapshot().actions).not.toContain("retry")
			expect(readChatStorageRecord(await storage.getItem(key))).toEqual({ version: 1, credential: "credential" })
		} finally {
			client.dispose()
		}
	})

	test("keeps an unrelated failure when the website action finished", async () => {
		const client = testClient({
			transport: baseTransport({
				sendMessage: async () =>
					streamFrom([
						acceptedEvent("generation"),
						{
							type: "part",
							assistantMessageId: "a1",
							index: 0,
							part: {
								type: "dynamic-tool",
								toolName: "readPage",
								toolCallId: "call-1",
								input: {},
								state: "output-available",
								output: { text: "Shop" },
								toolMetadata: { source: "client", displayName: "Read page", outcome: "completed" },
							},
						},
						{
							type: "error",
							outcome: "failed",
							error: { code: "provider-error", retriable: true, newChatAvailable: false },
						},
					]),
			}),
		})
		try {
			await client.initialize()
			await expect(client.sendMessage("Read it")).rejects.toMatchObject({ detail: { code: "provider-error" } })

			expect(client.getSnapshot().error).toMatchObject({ code: "provider-error", retriable: true })
		} finally {
			client.dispose()
		}
	})

	test("drops an unrecoverable website-tool send so the session can be used again", async () => {
		const memory = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		await memory.setItem(
			key,
			JSON.stringify({
				version: 1,
				credential: "credential",
				pending: { requestId: "request", text: "Update the page", clientTools: true },
			}),
		)
		const clearingStarted = Promise.withResolvers<void>()
		const finishClearing = Promise.withResolvers<void>()
		const clearingFinished = Promise.withResolvers<void>()
		const storage = {
			...memory,
			async setItem(storageKey: string, value: string) {
				const cleared = readChatStorageRecord(value)?.pending === undefined
				if (cleared) {
					clearingStarted.resolve()
					await finishClearing.promise
				}
				await memory.setItem(storageKey, value)
				if (cleared) clearingFinished.resolve()
			},
		}
		const options = {
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async () => ({ messages: [], activeGeneration: undefined }),
			}),
			recoveryDelays: [0],
		}
		const client = createChatClient(options)
		try {
			await client.initialize()
			// The exhausted state must publish before the cleanup write finishes.
			await waitForSnapshot(client, () => client.getSnapshot().notices.includes("recovery-unavailable"))
			await clearingStarted.promise
			finishClearing.resolve()
			await clearingFinished.promise

			expect(readChatStorageRecord(await memory.getItem(key))).toEqual({ version: 1, credential: "credential" })
			expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "Update the page", outcome: "interrupted" })
		} finally {
			client.dispose()
		}

		const reloaded = createChatClient(options)
		try {
			await reloaded.initialize()
			await waitForSnapshot(reloaded, () => reloaded.getSnapshot().activity === "idle")

			expect(reloaded.getSnapshot().actions).toContain("send")
		} finally {
			reloaded.dispose()
		}
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
				sendMessage: async (input) => {
					expect({ credential: input.credential, requestId: input.requestId, text: input.text }).toEqual({
						credential: "credential",
						...pending,
					})
					sends += 1
					return streamFrom([])
				},
			}),
			recoveryDelays: [0],
		})

		await client.initialize()
		await waitForSnapshot(client, () => client.getSnapshot().notices.includes("recovery-unavailable"))
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
			activity: "idle",
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
		const order: Array<string> = []
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				loadSession: async () => ({
					messages: [
						{
							id: "u1",
							role: "user",
							text: "hello",
							parts: [{ type: "text", text: "hello" }],
							createdAt: "now",
							outcome: "completed",
						},
					],
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
		expect(client.getSnapshot()).toMatchObject({ messages: [], activity: "idle" })
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
		expect(client.getSnapshot()).toMatchObject({ activity: "resetting", actions: [] })
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
					messages: [
						{
							id: "u1",
							role: "user",
							text: "keep me",
							parts: [{ type: "text", text: "keep me" }],
							createdAt: "now",
							outcome: "completed",
						},
					],
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
		expect(client.getSnapshot()).toMatchObject({ activity: "recovering", error: { code: "reset-failed" } })
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
		expect(client.getSnapshot()).toMatchObject({ isAvailable: true, activity: "blocked", configuration })
		expect(client.getSnapshot().actions).toEqual(["new-chat"])
		expect(client.getSnapshot().error?.newChatAvailable).toBe(true)
		await client.startNewChat()

		expect(client.getSnapshot()).toMatchObject({
			activity: "idle",
			configuration,
			messages: [],
			error: undefined,
		})
		expect(await storage.getItem(key)).toBeNull()
	})

	test("fails reset without clearing state when persistent credential deletion falls back", async () => {
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
					messages: [
						{
							id: "u1",
							role: "user",
							text: "keep me",
							parts: [{ type: "text", text: "keep me" }],
							createdAt: "now",
							outcome: "completed",
						},
					],
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
			messages: [{ text: "keep me" }],
			error: { code: "reset-failed" },
			notices: ["storage-unavailable"],
		})
		expect(readChatStorageRecord(persisted)).toEqual({ version: 1, credential: "credential" })
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
					return abortableStream(signal)
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

		await waitForSnapshot(client, () => client.getSnapshot().notices.includes("recovery-unavailable"))
		expect(client.getSnapshot()).toMatchObject({
			activity: "blocked",
			error: { code: "chat-session-unauthorized", status: 401 },
		})
	})

	// The two orderings of the abort settling around the failed cancel take different paths through
	// the recovery observer, and neither reproduces from the other.
	for (const sendSettlesFirst of [true, false]) {
		test(`recovers a failed pre-accept cancellation by observation without resubmitting ${sendSettlesFirst ? "after" : "before"} send abort`, async () => {
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
						return abortableStream(signal)
					},
					cancelResponse: async () => {
						cancellationStarted.resolve()
						await cancellation.promise
					},
					loadSession: async () => ({
						messages: [
							{
								id: "u1",
								role: "user",
								text: "hello",
								parts: [{ type: "text", text: "hello" }],
								createdAt: "now",
								outcome: "completed",
							},
						],
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
			await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

			expect(sends).toBe(1)
			expect(client.getSnapshot()).toMatchObject({
				activity: "idle",
				messages: [{ id: "u1", outcome: "completed" }],
			})
			expect(
				readChatStorageRecord(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))),
			).toEqual({ version: 1, credential: "11111111-1111-4111-8111-111111111111" })
		})
	}

	test("a definite rejection settles before the cancellation failure", async () => {
		const storage = createMemoryStorage()
		const sent = Promise.withResolvers<void>()
		const sendRejected = Promise.withResolvers<void>()
		let sending: Promise<unknown> | undefined
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				sendMessage: async () => {
					sent.resolve()
					await sendRejected.promise
					throw new ChatTransportError({ code: "chat-session-unauthorized", status: 401 })
				},
				cancelResponse: async () => {
					await sending
					throw new ChatTransportError({ code: "chat-session-unauthorized", status: 401 })
				},
				loadSession: async () => {
					throw new Error("A rejected send is not recoverable")
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		sending = client.sendMessage("hello").catch((cause: unknown) => cause)
		await sent.promise
		const cancelling = client.cancelResponse()
		sendRejected.resolve()
		await sending
		await cancelling

		expect(client.getSnapshot()).toMatchObject({
			activity: "idle",
			messages: [],
			error: { code: "chat-session-unauthorized", status: 401 },
		})
		expect(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))).toBeNull()
	})

	test("a definite rejection still settles idle when the cancellation failure arrives first", async () => {
		const storage = createMemoryStorage()
		const sent = Promise.withResolvers<void>()
		const sendRejected = Promise.withResolvers<void>()
		const cancellationFailed = Promise.withResolvers<void>()
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				sendMessage: async () => {
					sent.resolve()
					await sendRejected.promise
					throw new ChatTransportError({ code: "chat-session-unauthorized", status: 401 })
				},
				cancelResponse: async () => {
					await cancellationFailed.promise
					throw new ChatTransportError({ code: "chat-session-unauthorized", status: 401 })
				},
			}),
			randomUUID: () => "11111111-1111-4111-8111-111111111111",
			recoveryDelays: [0],
		})
		await client.initialize()
		const sending = client.sendMessage("hello").catch((cause: unknown) => cause)
		await sent.promise
		const cancelling = client.cancelResponse()
		cancellationFailed.resolve()
		await cancelling
		sendRejected.resolve()
		await sending

		expect(client.getSnapshot()).toMatchObject({
			activity: "idle",
			messages: [],
			error: { code: "chat-session-unauthorized", status: 401 },
		})
		expect(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))).toBeNull()
	})

	test("a failed post-acceptance cancellation keeps a concurrently completed state", async () => {
		const terminal = deferred<void>()
		const cancellation = deferred<void>()
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					sends += 1
					return {
						async *[Symbol.asyncIterator]() {
							yield {
								type: "accepted",
								requestId: "request",
								generationId: "generation",
								userMessage: { id: "user", createdAt: "now" },
								assistantMessage: { id: "assistant", createdAt: "now" },
							} as const
							signal.throwIfAborted()
							await terminal.promise
							signal.throwIfAborted()
							yield { type: "terminal", outcome: "completed" } as const
						},
					}
				},
				cancelResponse: async () => {
					await cancellation.promise
				},
			}),
		})
		await client.initialize()
		const sending = client.sendMessage("hello")
		await waitForSnapshot(client, () => client.getSnapshot().activity === "responding")
		const cancelling = client.cancelResponse()
		terminal.resolve()
		await sending
		cancellation.reject(new Error("cancel failed"))
		await expect(cancelling).rejects.toThrow("cancel failed")

		expect(client.getSnapshot()).toMatchObject({ activity: "idle", error: undefined })
		await expect(client.sendMessage("again")).resolves.toBeUndefined()
		expect(sends).toBe(2)
	})

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

		expect(client.getSnapshot().activity).toBe("stopping")
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
		expect(client.getSnapshot()).toMatchObject({ notices: [], error: { code: "storage-unavailable" } })
		void client.sendMessage("hello").catch(() => undefined)
		await started.promise
		const beforeDispose = notifications

		client.dispose()

		expect(aborted).toBe(true)
		expect(notifications).toBe(beforeDispose)
		await expect(client.sendMessage("later")).rejects.toThrow("disposed")
	})

	test("rejects sends when Web Crypto is unavailable", async () => {
		using randomUUIDSpy = spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
			throw new Error("crypto unavailable")
		})
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage: createMemoryStorage(),
			transport: baseTransport(),
		})
		await client.initialize()

		await expect(client.sendMessage("hello")).rejects.toThrow("Web Crypto is required to generate chat credentials")
		expect(client.getSnapshot()).toMatchObject({ activity: "idle", messages: [] })
		expect(randomUUIDSpy).toHaveBeenCalled()
	})
})

describe("chat client snapshots", () => {
	test("reports the loading state before initialization completes", () => {
		const client = testClient()

		expect(client.getSnapshot()).toEqual({
			isAvailable: false,
			configuration: undefined,
			activeTools: [],
			messages: [],
			activity: "loading",
			actions: [],
			notices: [],
			acceptedMessageId: undefined,
			error: undefined,
		})
	})

	test("exposes the error name and detail of a rejected command", () => {
		const detail = { code: "chat-unavailable" } as const

		expect(new ChatClientError(detail)).toMatchObject({
			name: "ChatClientError",
			message: "chat-unavailable",
			detail,
		})
	})

	test("loads configuration once for repeated and concurrent initialization", async () => {
		let configurations = 0
		const client = testClient({
			transport: baseTransport({
				loadConfiguration: async () => {
					configurations += 1
					return configuration
				},
			}),
		})

		await Promise.all([client.initialize(), client.initialize()])
		await client.initialize()

		expect(configurations).toBe(1)
	})

	test("keeps the chat blocked without offering new chat when initialization fails", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: CREDENTIAL }),
		)
		const client = testClient({
			storage,
			transport: baseTransport({
				loadSession: async () => {
					throw new Error("offline")
				},
			}),
		})

		await expect(client.initialize()).rejects.toThrow("offline")

		expect(client.getSnapshot()).toMatchObject({
			isAvailable: true,
			activity: "blocked",
			actions: [],
			error: { code: "transport-error" },
		})
		expect(client.getSnapshot().error?.newChatAvailable).toBe(false)
	})

	test("exposes the latest completed user message as the accepted message", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: CREDENTIAL }),
		)
		const client = testClient({
			storage,
			transport: baseTransport({
				loadSession: async () => ({
					messages: [
						{
							id: "u1",
							role: "user",
							text: "one",
							parts: [{ type: "text", text: "one" }],
							createdAt: "now",
							outcome: "completed",
						},
						{
							id: "a1",
							role: "assistant",
							text: "reply",
							parts: [{ type: "text", text: "reply" }],
							createdAt: "now",
							outcome: "completed",
						},
						{
							id: "u2",
							role: "user",
							text: "two",
							parts: [{ type: "text", text: "two" }],
							createdAt: "now",
							outcome: "interrupted",
						},
					],
					activeGeneration: undefined,
				}),
			}),
		})

		await client.initialize()

		expect(client.getSnapshot().acceptedMessageId).toBe("u1")
	})

	for (const [code, newChatAvailable] of [
		["chat-conversation-too-long", true],
		["chat-context-limit", true],
		["chat-daily-allowance-exceeded", false],
	] as const) {
		test(`derives new-chat availability from the ${code} error`, async () => {
			const client = testClient({
				transport: baseTransport({
					sendMessage: async () =>
						streamFrom([acceptedEvent("generation"), { type: "error", outcome: "blocked", error: { code } }]),
				}),
			})
			await client.initialize()

			await expect(client.sendMessage("hello")).rejects.toThrow(code)

			expect(client.getSnapshot().error).toMatchObject({ code, newChatAvailable })
		})
	}

	const retryCases = [
		{
			name: "a retriable failed response",
			error: { code: "provider-error", retriable: true },
			outcome: "failed",
			actions: ["send", "retry", "new-chat"],
			retryError: undefined,
		},
		{
			name: "a retriable blocked response",
			error: { code: "provider-error", retriable: true },
			outcome: "blocked",
			actions: ["send", "new-chat"],
			retryError: "No failed response",
		},
		{
			name: "a non-retriable failed response",
			error: { code: "provider-error" },
			outcome: "failed",
			actions: ["send", "new-chat"],
			retryError: "not retriable",
		},
	] as const

	for (const { name, error, outcome, actions, retryError } of retryCases) {
		test(`offers retry only after ${name}`, async () => {
			let attempts = 0
			const client = testClient({
				transport: baseTransport({
					sendMessage: async () => {
						attempts += 1
						return attempts === 1
							? streamFrom([acceptedEvent("generation"), { type: "error", outcome, error }])
							: streamFrom([
									acceptedEvent("retry", { user: "u2", assistant: "a2" }),
									{ type: "terminal", outcome: "completed" },
								])
					},
				}),
			})
			await client.initialize()
			await expect(client.sendMessage("hello")).rejects.toThrow("provider-error")

			expect(client.getSnapshot().actions).toEqual(actions)
			expect(client.getSnapshot().messages.at(-1)?.outcome).toBe(outcome)
			if (retryError === undefined) {
				await expect(client.retryLastMessage()).resolves.toBeUndefined()
			} else {
				await expect(client.retryLastMessage()).rejects.toThrow(retryError)
			}
		})
	}

	test("rejects usage that violates the chat lifecycle", async () => {
		let sends = 0
		const client = testClient({
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					return streamFrom([])
				},
			}),
		})

		await expect(client.sendMessage("before initialize")).rejects.toThrow("not initialized")
		await client.initialize()
		await expect(client.sendMessage("")).rejects.toThrow("must not be empty")
		await expect(client.retryLastMessage()).rejects.toThrow("not retriable")

		expect(sends).toBe(0)
		expect(client.getSnapshot()).toMatchObject({ activity: "idle", messages: [] })
	})
})

describe("chat send lifecycle", () => {
	for (const { detail, definite } of [
		{ detail: { code: "invalid-request", status: 400 }, definite: true },
		{ detail: { code: "internal-server-error", status: 500 }, definite: false },
		{ detail: { code: "transport-error" }, definite: false },
	] as const) {
		test(`treats a pre-acceptance ${detail.code} with status ${detail.status ?? "none"} as ${definite ? "definite" : "uncertain"}`, async () => {
			const rejection = new ChatTransportError(detail)
			const client = testClient({
				transport: baseTransport({
					sendMessage: async () => {
						throw rejection
					},
					loadSession: unresolvedSession,
				}),
				recoveryDelays: [0],
			})
			await client.initialize()

			await expect(client.sendMessage("hello")).rejects.toBe(rejection)

			if (definite) {
				expect(client.getSnapshot()).toMatchObject({ activity: "idle", messages: [], error: rejection.detail })
			} else {
				expect(client.getSnapshot()).toMatchObject({
					activity: "recovering",
					messages: [{ text: "hello", outcome: "interrupted" }],
					error: rejection.detail,
				})
			}
			client.dispose()
		})
	}

	test("keeps an established conversation when the server definitely rejects a send", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: CREDENTIAL }),
		)
		const rejection = new ChatTransportError({ code: "invalid-request", status: 400 })
		const credentials: Array<string> = []
		const client = testClient({
			storage,
			transport: baseTransport({
				loadSession: async () => ({
					messages: [
						{
							id: "u1",
							role: "user",
							text: "earlier",
							parts: [{ type: "text", text: "earlier" }],
							createdAt: "now",
							outcome: "completed",
						},
					],
					activeGeneration: undefined,
				}),
				sendMessage: async (input) => {
					credentials.push(input.credential)
					throw rejection
				},
			}),
		})
		await client.initialize()

		await expect(client.sendMessage("hello")).rejects.toBe(rejection)

		expect(client.getSnapshot()).toMatchObject({
			activity: "idle",
			messages: [{ id: "u1", text: "earlier" }],
			error: rejection.detail,
		})
		expect(
			readChatStorageRecord(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))),
		).toEqual({ version: 1, credential: CREDENTIAL })

		await expect(client.sendMessage("again")).rejects.toBe(rejection)
		expect(credentials).toEqual([CREDENTIAL, CREDENTIAL])
	})

	test("publishes the optimistic message and its timestamp before acceptance", async () => {
		const response = deferred<AsyncIterable<ChatEvent>>()
		const client = testClient({
			now: () => new Date("2026-09-11T00:00:00.000Z"),
			transport: baseTransport({ sendMessage: () => response.promise }),
		})
		await client.initialize()

		const sending = client.sendMessage("hello").catch((cause: unknown) => cause)
		await waitForSnapshot(client, () => client.getSnapshot().messages.length === 1)

		expect(client.getSnapshot().messages).toEqual([
			{
				id: `pending:${CREDENTIAL}`,
				role: "user",
				text: "hello",
				parts: [{ type: "text", text: "hello" }],
				createdAt: "2026-09-11T00:00:00.000Z",
				outcome: "pending",
			},
		])

		response.resolve(streamFrom([]))
		expect(await sending).toBeInstanceOf(Error)
		client.dispose()
	})

	test("rejects a stream that closes without a terminal event", async () => {
		const client = testClient({
			transport: baseTransport({
				sendMessage: async () => streamFrom([acceptedEvent("generation")]),
				loadSession: unresolvedSession,
			}),
			recoveryDelays: [0],
		})
		await client.initialize()

		await expect(client.sendMessage("hello")).rejects.toThrow("without a terminal event")

		expect(client.getSnapshot()).toMatchObject({ activity: "recovering" })
		expect(client.getSnapshot().messages).toMatchObject([
			{ id: "u1", outcome: "completed" },
			{ id: "a1", outcome: "interrupted" },
		])
		client.dispose()
	})

	test("rejects a stream that accepts the request twice", async () => {
		const client = testClient({
			transport: baseTransport({
				sendMessage: async () => streamFrom([acceptedEvent("generation"), acceptedEvent("other")]),
				loadSession: unresolvedSession,
			}),
			recoveryDelays: [0],
		})
		await client.initialize()

		await expect(client.sendMessage("hello")).rejects.toThrow("more than once")
		client.dispose()
	})

	test("tracks each tool call until it finishes and clears unfinished calls on terminal", async () => {
		const client = testClient({
			transport: baseTransport({
				sendMessage: async () =>
					streamFrom([
						acceptedEvent("generation"),
						{
							type: "part",
							assistantMessageId: "a1",
							index: 0,
							part: toolPart("call-1", "Shopify", "get_product", "input-available"),
						},
						{
							type: "part",
							assistantMessageId: "a1",
							index: 1,
							part: toolPart("call-2", "Shopify", "get_product", "input-available"),
						},
						{
							type: "part",
							assistantMessageId: "a1",
							index: 2,
							part: toolPart("call-3", "Warehouse", "get_product", "input-available"),
						},
						{
							type: "part",
							assistantMessageId: "a1",
							index: 0,
							part: toolPart("call-1", "Shopify", "get_product", "output-available"),
						},
						{ type: "terminal", outcome: "completed" },
					]),
			}),
		})
		await client.initialize()
		const observed: string[][] = []
		client.subscribe(() => observed.push(client.getSnapshot().activeTools.map((tool) => tool.toolCallId ?? "")))

		await client.sendMessage("is it in stock?")

		expect(observed).toContainEqual(["call-1", "call-2", "call-3"])
		expect(observed).toContainEqual(["call-2", "call-3"])
		expect(client.getSnapshot().activeTools).toEqual([])
	})
})

describe("chat cancellation", () => {
	test("hides stop while a cancellation is pending", async () => {
		const accepted = deferred<void>()
		const cancellationStarted = deferred<void>()
		const cancellation = deferred<void>()
		const client = testClient({
			transport: baseTransport({
				sendMessage: async ({ signal }) => ({
					async *[Symbol.asyncIterator]() {
						yield acceptedEvent("generation")
						accepted.resolve()
						await new Promise<void>((_resolve, reject) => {
							signal.addEventListener("abort", () => reject(signal.reason), { once: true })
						})
					},
				}),
				cancelResponse: async () => {
					cancellationStarted.resolve()
					await cancellation.promise
				},
			}),
		})
		await client.initialize()
		const sending = client.sendMessage("hello").catch((cause: unknown) => cause)
		await accepted.promise

		const cancelling = client.cancelResponse()
		await cancellationStarted.promise

		expect(client.getSnapshot()).toMatchObject({ activity: "stopping", actions: ["new-chat"] })
		cancellation.resolve()
		await cancelling
		expect(await sending).toBeInstanceOf(Error)
	})

	test("passes the active generation and allows cancelling a later response", async () => {
		const cancellations: Array<{ credential: string; generationId?: string }> = []
		let sends = 0
		const client = testClient({
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					sends += 1
					const attempt = sends
					return {
						async *[Symbol.asyncIterator]() {
							yield acceptedEvent(`generation-${attempt}`, {
								user: `u${attempt}`,
								assistant: `a${attempt}`,
							})
							await new Promise<void>((_resolve, reject) => {
								signal.addEventListener("abort", () => reject(signal.reason), { once: true })
							})
						},
					}
				},
				cancelResponse: async (input) => {
					cancellations.push({ credential: input.credential, generationId: input.generationId })
				},
			}),
		})
		await client.initialize()

		async function cancelActiveResponse(text: string) {
			const sending = client.sendMessage(text).catch((cause: unknown) => cause)
			await waitForSnapshot(client, () => client.getSnapshot().activity === "responding")
			await client.cancelResponse()
			expect(await sending).toBeInstanceOf(Error)
		}

		await cancelActiveResponse("one")
		await cancelActiveResponse("two")

		expect(cancellations).toEqual([
			{ credential: CREDENTIAL, generationId: "generation-1" },
			{ credential: CREDENTIAL, generationId: "generation-2" },
		])
		expect(client.getSnapshot().activity).toBe("idle")
	})

	test("ignores a stop request while idle", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: CREDENTIAL }),
		)
		let cancellations = 0
		const client = testClient({
			storage,
			transport: baseTransport({
				cancelResponse: async () => {
					cancellations += 1
				},
			}),
		})
		await client.initialize()

		await client.cancelResponse()

		expect(cancellations).toBe(0)
		expect(client.getSnapshot().activity).toBe("idle")
	})

	test("does not contact the server to cancel an undelivered send", async () => {
		const memory = createMemoryStorage()
		const write = deferred<void>()
		let firstWrite = true
		let cancellations = 0
		let sends = 0
		const client = testClient({
			storage: {
				...memory,
				async setItem(key, value) {
					if (firstWrite) {
						firstWrite = false
						await write.promise
					}
					await memory.setItem(key, value)
				},
			},
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					sends += 1
					signal.throwIfAborted()
					return streamFrom([])
				},
				cancelResponse: async () => {
					cancellations += 1
				},
			}),
		})
		await client.initialize()
		const sending = client.sendMessage("hello").catch((cause: unknown) => cause)

		const cancelling = client.cancelResponse()
		write.resolve()
		await cancelling

		expect(await sending).toBeInstanceOf(Error)
		expect(cancellations).toBe(0)
		expect(sends).toBe(0)
		expect(await memory.getItem(createChatStorageKey("https://api.example.test", "embed"))).toBeNull()
		expect(client.getSnapshot()).toMatchObject({ activity: "idle", messages: [] })
	})

	for (const { name, failure, error } of cancellationFailures) {
		test(`reports cancel-failed after ${name} while cancelling an undelivered send`, async () => {
			const started = deferred<void>()
			const client = testClient({
				transport: baseTransport({
					sendMessage: async ({ signal }) => {
						started.resolve()
						return abortableStream(signal)
					},
					cancelResponse: async () => {
						throw failure
					},
					loadSession: unresolvedSession,
				}),
				recoveryDelays: [0],
			})
			await client.initialize()
			const sending = client.sendMessage("hello").catch((cause: unknown) => cause)
			await started.promise

			await expect(client.cancelResponse()).rejects.toBe(failure)

			expect(await sending).toBeInstanceOf(Error)
			expect(client.getSnapshot()).toMatchObject({ activity: "recovering", error })
			expect(client.getSnapshot().messages).toMatchObject([{ id: `pending:${CREDENTIAL}`, outcome: "interrupted" }])
			client.dispose()
		})
	}

	for (const { name, failure, error } of cancellationFailures) {
		test(`resumes responding after ${name} while cancelling an accepted response`, async () => {
			const client = testClient({
				transport: baseTransport({
					sendMessage: async ({ signal }) => ({
						async *[Symbol.asyncIterator]() {
							yield acceptedEvent("generation")
							await new Promise<void>((_resolve, reject) => {
								signal.addEventListener("abort", () => reject(signal.reason), { once: true })
							})
						},
					}),
					cancelResponse: async () => {
						throw failure
					},
				}),
			})
			await client.initialize()
			const sending = client.sendMessage("hello").catch((cause: unknown) => cause)
			await waitForSnapshot(client, () => client.getSnapshot().activity === "responding")

			await expect(client.cancelResponse()).rejects.toBe(failure)

			expect(client.getSnapshot()).toMatchObject({ activity: "responding", error })
			expect(client.getSnapshot().actions).toEqual(["stop", "new-chat"])
			client.dispose()
			expect(await sending).toBeInstanceOf(Error)
		})
	}
})

describe("chat recovery", () => {
	test("marks an unfinished recovered response as interrupted when recovery is exhausted", async () => {
		let sends = 0
		const client = testClient({
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					if (sends === 1) throw new Error("connection lost")
					return streamFrom([])
				},
				loadSession: async () => ({
					messages: [
						{
							id: "u1",
							role: "user",
							text: "hello",
							parts: [{ type: "text", text: "hello" }],
							createdAt: "now",
							outcome: "completed",
						},
						{
							id: "a1",
							role: "assistant",
							text: "partial",
							parts: [{ type: "text", text: "partial" }],
							createdAt: "now",
							outcome: "streaming",
						},
					],
					activeGeneration: { id: "generation" },
				}),
			}),
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")

		await waitForSnapshot(client, () => client.getSnapshot().notices.includes("recovery-unavailable"))

		expect(client.getSnapshot()).toMatchObject({ activity: "blocked" })
		expect(client.getSnapshot().messages).toMatchObject([
			{ id: "u1", outcome: "completed" },
			{ id: "a1", outcome: "interrupted" },
		])
	})

	test("shows a stored pending message as interrupted while it is recovered", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: CREDENTIAL, pending: { requestId: "request", text: "hello" } }),
		)
		const client = testClient({
			storage,
			now: () => new Date("2026-09-11T00:00:00.000Z"),
			transport: baseTransport({
				sendMessage: () => new Promise<AsyncIterable<ChatEvent>>(() => {}),
			}),
			recoveryDelays: [0],
		})

		await client.initialize()

		expect(client.getSnapshot()).toMatchObject({ activity: "recovering" })
		expect(client.getSnapshot().messages).toEqual([
			{
				id: "pending:request",
				role: "user",
				text: "hello",
				parts: [{ type: "text", text: "hello" }],
				createdAt: "2026-09-11T00:00:00.000Z",
				outcome: "interrupted",
			},
		])
		client.dispose()
	})

	test("polls an existing active generation after initialization", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: CREDENTIAL }),
		)
		let loads = 0
		const client = testClient({
			storage,
			transport: baseTransport({
				loadSession: async () => {
					loads += 1
					return loads === 1
						? {
								messages: [
									{
										id: "a1",
										role: "assistant",
										text: "partial",
										parts: [{ type: "text", text: "partial" }],
										createdAt: "now",
										outcome: "streaming",
									},
								],
								activeGeneration: { id: "generation" },
							}
						: { messages: [], activeGeneration: undefined }
				},
			}),
			recoveryDelays: [0],
		})

		await client.initialize()
		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")
		await new Promise((resolve) => {
			setTimeout(resolve, 20)
		})

		expect(loads).toBe(2)
		expect(client.getSnapshot().messages).toEqual([])
	})

	test("does not poll a session without an active generation", async () => {
		const storage = createMemoryStorage()
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, credential: CREDENTIAL }),
		)
		let loads = 0
		const client = testClient({
			storage,
			transport: baseTransport({
				loadSession: async () => {
					loads += 1
					return { messages: [], activeGeneration: undefined }
				},
			}),
			recoveryDelays: [0],
		})

		await client.initialize()
		await new Promise((resolve) => {
			setTimeout(resolve, 20)
		})

		expect(loads).toBe(1)
		expect(client.getSnapshot().activity).toBe("idle")
	})

	test("closes the response stream used to confirm an uncertain send", async () => {
		let sends = 0
		let closed = 0
		const client = testClient({
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					if (sends === 1) throw new Error("connection lost")
					return {
						[Symbol.asyncIterator]: () => ({
							next: () => new Promise<IteratorResult<ChatEvent>>(() => {}),
							return: async () => {
								closed += 1
								return { done: true, value: undefined }
							},
						}),
					}
				},
				loadSession: async () => ({ messages: [], activeGeneration: undefined }),
			}),
			recoveryDelays: [0],
		})
		await client.initialize()

		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().activity === "idle")

		expect(closed).toBe(1)
	})
})

describe("chat storage", () => {
	test("persists credentials through the global localStorage by default", async () => {
		const values = new Map<string, string>()
		const key = createChatStorageKey("https://api.example.test", "embed")
		values.set(key, JSON.stringify({ version: 1, credential: CREDENTIAL }))
		const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			value: {
				getItem: (name: string) => values.get(name) ?? null,
				setItem: (name: string, value: string) => values.set(name, value),
				removeItem: (name: string) => values.delete(name),
			},
		})
		try {
			const client = createChatClient({
				apiUrl: "https://api.example.test",
				embedToken: "embed",
				randomUUID: () => CREDENTIAL,
				transport: baseTransport({
					loadSession: async () => ({
						messages: [
							{
								id: "u1",
								role: "user",
								text: "earlier",
								parts: [{ type: "text", text: "earlier" }],
								createdAt: "now",
								outcome: "completed",
							},
						],
						activeGeneration: undefined,
					}),
					sendMessage: async (input) => {
						expect(readChatStorageRecord(values.get(key) ?? null)).toEqual({
							version: 1,
							credential: CREDENTIAL,
							pending: { requestId: input.requestId, text: "hello" },
						})
						return streamFrom([
							acceptedEvent("generation", { user: "u2", assistant: "a2" }),
							{ type: "terminal", outcome: "completed" },
						])
					},
				}),
			})

			await client.initialize()
			expect(client.getSnapshot().messages).toMatchObject([{ id: "u1" }])
			await client.sendMessage("hello")
			expect(readChatStorageRecord(values.get(key) ?? null)).toEqual({ version: 1, credential: CREDENTIAL })

			await client.startNewChat()
			expect(values.has(key)).toBe(false)
		} finally {
			if (previous === undefined) Reflect.deleteProperty(globalThis, "localStorage")
			else Object.defineProperty(globalThis, "localStorage", previous)
		}
	})
})

describe("chat reset and disposal", () => {
	test("cancels a dispatch in flight before starting a new chat", async () => {
		const started = deferred<void>()
		let cancellations = 0
		const client = testClient({
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					started.resolve()
					return abortableStream(signal)
				},
				cancelResponse: async () => {
					cancellations += 1
				},
			}),
		})
		await client.initialize()
		const sending = client.sendMessage("hello").catch((cause: unknown) => cause)
		await started.promise

		await client.startNewChat()

		expect(cancellations).toBe(1)
		expect(await sending).toBeInstanceOf(Error)
		expect(client.getSnapshot()).toMatchObject({ activity: "idle", messages: [], actions: ["send", "new-chat"] })
	})

	test("does not cancel server work when starting a new chat from idle", async () => {
		const storage = createMemoryStorage()
		const key = createChatStorageKey("https://api.example.test", "embed")
		await storage.setItem(key, JSON.stringify({ version: 1, credential: CREDENTIAL }))
		let cancellations = 0
		const client = testClient({
			storage,
			transport: baseTransport({
				cancelResponse: async () => {
					cancellations += 1
				},
			}),
		})
		await client.initialize()

		await client.startNewChat()

		expect(cancellations).toBe(0)
		expect(client.getSnapshot()).toMatchObject({ activity: "idle", messages: [], actions: ["send", "new-chat"] })
		expect(await storage.getItem(key)).toBeNull()
	})

	test("aborts an active send and rejects new listeners after disposal", async () => {
		const started = deferred<void>()
		const client = testClient({
			transport: baseTransport({
				sendMessage: async ({ signal }) => {
					started.resolve()
					return abortableStream(signal)
				},
			}),
		})
		await client.initialize()
		const sending = client.sendMessage("hello")
		await started.promise

		client.dispose()

		await expect(sending).rejects.toThrow("Chat client disposed")
		expect(() => client.subscribe(() => undefined)).toThrow("disposed")
		await expect(client.initialize()).rejects.toThrow("disposed")
		await expect(client.sendMessage("later")).rejects.toThrow("disposed")
		await expect(client.retryLastMessage()).rejects.toThrow("disposed")
		expect(() => client.cancelResponse()).toThrow("disposed")

		const idleClient = testClient()
		await idleClient.initialize()
		idleClient.dispose()
		await expect(idleClient.startNewChat()).rejects.toThrow("disposed")
	})
})
