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
		recoverBootstrap: async () => ({ status: "not-accepted" }),
		sendMessage: async () => streamFrom([]),
		cancelResponse: async () => undefined,
		...overrides,
	}
}

describe("createChatClient", () => {
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
			randomBytes: () => {
				randomCalls += 1
				return new Uint8Array(32)
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

	test("clears a definitely rejected bootstrap and permits a different send", async () => {
		const storage = createMemoryStorage()
		const rejection = new ChatTransportError({
			code: "chat-daily-allowance-exceeded",
			status: 429,
			message: "allowance reached",
			retriable: true,
			newChatAvailable: false,
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
							credential: "credential",
							generationId: "generation",
							userMessage: { id: "u2", createdAt: "now" },
							assistantMessage: { id: "a2", createdAt: "now" },
						},
						{ type: "terminal", outcome: "completed" },
					])
				},
			}),
			randomBytes: (length) => new Uint8Array(length).fill(sends + 1),
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

	test("polls uncertain bootstrap recovery through accepted session completion without regenerating", async () => {
		const storage = createMemoryStorage()
		const recoveries: { requestId: string; bootstrapSecret: string }[] = []
		let loads = 0
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					throw new Error("connection lost")
				},
				recoverBootstrap: async ({ requestId, bootstrapSecret }) => {
					recoveries.push({ requestId, bootstrapSecret })
					return recoveries.length === 1
						? { status: "not-accepted" as const }
						: { status: "accepted" as const, credential: "credential" }
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
			randomBytes: (length) => new Uint8Array(length).fill(length),
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")

		expect(sends).toBe(1)
		expect(recoveries).toHaveLength(2)
		expect(recoveries[1]).toEqual(recoveries[0])
		expect(loads).toBe(2)
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "recovered", outcome: "completed" })
		expect(
			readChatStorageRecord(await storage.getItem(createChatStorageKey("https://api.example.test", "embed"))),
		).toEqual({
			version: 1,
			credential: "credential",
		})
	})

	test("continues session recovery when the first load after bootstrap acceptance fails", async () => {
		let loads = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => {
					throw new Error("connection lost")
				},
				recoverBootstrap: async () => ({ status: "accepted", credential: "credential" }),
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
			randomBytes: (length) => new Uint8Array(length),
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "idle")

		expect(loads).toBe(2)
		expect(client.getSnapshot().messages.at(-1)).toMatchObject({ text: "recovered", outcome: "completed" })
	})

	for (const rejection of [
		new ChatTransportError({
			code: "internal-server-error",
			status: 503,
			message: "unavailable",
			retriable: true,
			newChatAvailable: false,
		}),
		new ChatTransportError({
			code: "invalid-response",
			status: 200,
			message: "invalid response",
			retriable: false,
			newChatAvailable: false,
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
					recoverBootstrap: async () => ({ status: "unavailable" }),
				}),
				randomBytes: (length) => new Uint8Array(length),
				recoveryDelays: [0],
			})
			await client.initialize()
			await expect(client.sendMessage("hello")).rejects.toBe(rejection)
			await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")

			expect(client.getSnapshot()).toMatchObject({ generation: "recovery", recovery: "unavailable" })
			expect(client.getSnapshot().messages[0]).toMatchObject({ outcome: "interrupted" })
		})
	}

	test("bounds not-accepted bootstrap recovery and never generates the pending request again", async () => {
		let recoveries = 0
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => {
					sends += 1
					throw new Error("connection lost")
				},
				recoverBootstrap: async () => {
					recoveries += 1
					return { status: "not-accepted" }
				},
			}),
			randomBytes: (length) => new Uint8Array(length),
			recoveryDelays: [0],
		})
		await client.initialize()
		await expect(client.sendMessage("hello")).rejects.toThrow("connection lost")
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")

		expect(recoveries).toBe(25)
		await expect(client.sendMessage("hello")).rejects.toThrow("recovered before sending")
		await expect(client.sendMessage("different")).rejects.toThrow("recovered before sending")
		expect(sends).toBe(1)
	})

	for (const event of [
		{ type: "delta", assistantMessageId: "a1", text: "invalid" },
		{ type: "terminal", outcome: "completed" },
		{
			type: "error",
			outcome: "failed",
			error: { code: "provider-error", message: "failed", retriable: true, newChatAvailable: false },
		},
	] satisfies ChatEvent[]) {
		test(`rejects ${event.type} before acceptance without resolving pending optimistic state`, async () => {
			const client = createChatClient({
				apiUrl: "https://api.example.test",
				embedToken: "embed",
				transport: baseTransport({
					sendMessage: async () => streamFrom([event]),
					recoverBootstrap: async () => ({ status: "unavailable" }),
				}),
				randomBytes: (length) => new Uint8Array(length),
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

	test("recovers but never resubmits a stored not-accepted bootstrap", async () => {
		const storage = createMemoryStorage()
		const pending = { requestId: "request", bootstrapSecret: "bootstrap", text: "hello" }
		await storage.setItem(
			createChatStorageKey("https://api.example.test", "embed"),
			JSON.stringify({ version: 1, pending }),
		)
		let recoveries = 0
		let sends = 0
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			storage,
			transport: baseTransport({
				recoverBootstrap: async (input) => {
					expect(input).toMatchObject({ requestId: pending.requestId, bootstrapSecret: pending.bootstrapSecret })
					recoveries += 1
					return { status: "not-accepted" }
				},
				sendMessage: async () => {
					sends += 1
					return streamFrom([])
				},
			}),
			randomBytes: () => {
				throw new Error("must reuse pending bootstrap")
			},
			recoveryDelays: [0],
		})

		await client.initialize()
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")
		await expect(client.sendMessage("hello")).rejects.toThrow("recovered before sending")

		expect(recoveries).toBe(25)
		expect(sends).toBe(0)
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
						message: "revoked",
						retriable: false,
						newChatAvailable: true,
					})
				},
			}),
		})

		await expect(client.initialize()).rejects.toThrow("revoked")
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
			error: { code: "reset_failed" },
			persistence: "memory",
		})
		expect(readChatStorageRecord(persisted)).toEqual({ version: 1, credential: "credential" })
		expect(key).toContain("talqo:chat:v1")
		await client.sendMessage("still usable")
		expect(sentCredential).toBe("credential")
	})

	test("treats a disconnect after failed cancellation as uncertain recovery", async () => {
		const stream = deferred<IteratorResult<ChatEvent>>()
		const sendStarted = deferred<void>()
		const client = createChatClient({
			apiUrl: "https://api.example.test",
			embedToken: "embed",
			transport: baseTransport({
				sendMessage: async () => {
					sendStarted.resolve()
					return { [Symbol.asyncIterator]: () => ({ next: () => stream.promise }) }
				},
				cancelResponse: async () => {
					throw new Error("cancel failed")
				},
				recoverBootstrap: async () => ({ status: "unavailable" }),
			}),
			randomBytes: (length) => new Uint8Array(length),
			recoveryDelays: [0],
		})
		await client.initialize()
		const sending = client.sendMessage("hello")
		await sendStarted.promise
		await expect(client.cancelResponse()).rejects.toThrow("cancel failed")
		stream.reject(new Error("disconnected"))
		await expect(sending).rejects.toThrow("disconnected")
		await waitForSnapshot(client, () => client.getSnapshot().recovery === "unavailable")

		expect(client.getSnapshot()).toMatchObject({ generation: "recovery", recovery: "unavailable" })
		expect(client.getSnapshot().messages[0]).toMatchObject({ outcome: "interrupted" })
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
								credential: "credential",
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
			randomBytes: (length) => new Uint8Array(length),
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
			randomBytes: (length) => new Uint8Array(length),
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
