import type { ChatClient, ChatError, ChatMessage, ChatSnapshot } from "@talqo/sdk"
import type { Root } from "react-dom/client"

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

await import("./test-setup")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConnectedEmbeddedWidget, EmbeddedWidget } = await import("./embedded-widget")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

const READY_SNAPSHOT: ChatSnapshot = {
	configuration: {
		title: "SDK support",
		appearance: {
			theme: "light",
			light: { primary: "#123456", background: "#fefefe" },
		},
	},
	messages: [],
	initialization: "ready",
	generation: "idle",
	reset: "idle",
	persistence: "persistent",
	recovery: "idle",
	error: undefined,
	retryAt: undefined,
}

const noopAction = async () => {}

function fakeClient(initial: ChatSnapshot = READY_SNAPSHOT) {
	let snapshot = initial
	const listeners = new Set<() => void>()
	const calls = { cancel: 0, initialize: 0, newChat: 0, sends: [] as string[] }
	let initialize = noopAction
	let sendMessage: (text: string) => Promise<void> = noopAction
	let cancelResponse = noopAction
	let startNewChat = noopAction
	const client: ChatClient = {
		subscribe(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		getSnapshot: () => snapshot,
		async initialize() {
			calls.initialize += 1
			await initialize()
		},
		async sendMessage(text) {
			calls.sends.push(text)
			await sendMessage(text)
		},
		async cancelResponse() {
			calls.cancel += 1
			await cancelResponse()
		},
		async startNewChat() {
			calls.newChat += 1
			await startNewChat()
		},
		dispose() {},
	}
	return {
		calls,
		client,
		setSnapshot(next: ChatSnapshot) {
			snapshot = next
			for (const listener of listeners) listener()
		},
		onInitialize(action: typeof initialize) {
			initialize = action
		},
		onSend(action: typeof sendMessage) {
			sendMessage = action
		},
		onCancel(action: typeof cancelResponse) {
			cancelResponse = action
		},
		onNewChat(action: typeof startNewChat) {
			startNewChat = action
		},
	}
}

function message(id: string, role: ChatMessage["role"], text: string, outcome: ChatMessage["outcome"]): ChatMessage {
	return { id, role, text, outcome, createdAt: "2026-09-12T00:00:00Z" }
}

function error(code: string, overrides: Partial<ChatError> = {}): ChatError {
	return { code, message: "raw server text", retriable: false, newChatAvailable: false, ...overrides }
}

let host: HTMLDivElement
let root: Root

async function render(element: React.ReactElement) {
	await act(async () => root.render(element))
}

async function openChat() {
	await act(async () => host.querySelector<HTMLButtonElement>("button[aria-haspopup=dialog]")?.click())
}

function input(): HTMLInputElement {
	const element = host.querySelector<HTMLInputElement>("input[aria-label='Message']")
	if (!element) throw new Error("message input not rendered")
	return element
}

async function draft(text: string) {
	await act(async () => {
		const element = input()
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(element, text)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function submit() {
	await act(async () =>
		host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	)
}

beforeEach(() => {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

describe("ConnectedEmbeddedWidget", () => {
	test("initializes the semantic client and uses SDK configuration with host overrides", async () => {
		const store = fakeClient()
		await render(
			<ConnectedEmbeddedWidget
				client={store.client}
				title="Host title"
				appearance={{ light: { primary: "#654321" } }}
			/>,
		)

		expect(store.calls.initialize).toBe(1)
		expect(host.querySelector<HTMLElement>(".talqo-widget")?.style.getPropertyValue("--talqo-primary-input")).toBe(
			"#654321",
		)
		expect(host.querySelector<HTMLElement>(".talqo-widget")?.style.getPropertyValue("--talqo-background-input")).toBe(
			"#fefefe",
		)
		await openChat()
		expect(host.querySelector("h2")?.textContent).toBe("Host title")
		await render(<ConnectedEmbeddedWidget client={store.client} appearance={{ light: { primary: "#654321" } }} />)
		expect(host.querySelector("h2")?.textContent).toBe("SDK support")
	})

	test("renders SDK transcript updates and cancellation with partial cancelled output", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			generation: "streaming",
			messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part", "streaming")],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		expect(host.textContent).toContain("Part")
		await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label='Stop generating']")?.click())
		expect(store.calls.cancel).toBe(1)

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part", "cancelled")],
			}),
		)
		expect(host.textContent).toContain("Response cancelled")
	})

	test("trims sends, prevents duplicate submissions, and clears only after SDK acceptance", async () => {
		const store = fakeClient()
		let finish!: () => void
		store.onSend(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve
				}),
		)
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("  hello  ")
		await submit()
		await submit()

		expect(store.calls.sends).toEqual(["hello"])
		expect(input().value).toBe("  hello  ")
		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				generation: "streaming",
				messages: [message("u1", "user", "hello", "completed")],
			}),
		)
		expect(input().value).toBe("")
		await act(async () => finish())
	})

	test("rejects empty input and preserves a draft when a pre-accept send rejects", async () => {
		const store = fakeClient()
		store.onSend(async () => {
			throw new Error("rejected")
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("   ")
		await submit()
		expect(store.calls.sends).toEqual([])

		await draft("keep this")
		await submit()
		expect(store.calls.sends).toEqual(["keep this"])
		expect(input().value).toBe("keep this")
	})

	test("offers new chat for any conversation, preserving draft and focusing after success", async () => {
		const store = fakeClient({ ...READY_SNAPSHOT, messages: [message("u1", "user", "History", "completed")] })
		store.onNewChat(async () => store.setSnapshot(READY_SNAPSHOT))
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("unsent")

		const button = host.querySelector<HTMLButtonElement>("button[aria-label='New chat']")
		expect(button?.title).toBe("Start a new chat")
		await act(async () => button?.click())

		expect(store.calls.newChat).toBe(1)
		expect(input().value).toBe("unsent")
		expect(document.activeElement).toBe(input())
		expect(host.textContent).toContain("Hi there!")
	})

	test("retains history and draft and reports a reset failure", async () => {
		const history = [message("u1", "user", "Keep history", "completed")]
		const store = fakeClient({ ...READY_SNAPSHOT, messages: history })
		store.onNewChat(async () => {
			store.setSnapshot({ ...READY_SNAPSHOT, messages: history, error: error("reset_failed") })
			throw new Error("failed")
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("unsent")
		await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label='New chat']")?.click())

		expect(host.textContent).toContain("Keep history")
		expect(host.textContent).toContain("Could not start a new chat")
		expect(input().value).toBe("unsent")
	})

	test("renders localized stable error codes and conversation-full action", async () => {
		const cases = [
			["chat-daily-allowance-exceeded", "network's daily message allowance"],
			["chat-concurrency-limit", "Too many responses are being generated"],
			["chat-session-busy", "This conversation already has a response"],
			["chat-session-unauthorized", "session is invalid or has been revoked"],
			["embed-not-found", "embed is unavailable or invalid"],
			["storage_unavailable", "cannot be restored after a reload"],
			["transport_error", "connection to chat failed"],
		] as const
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		for (const [code, text] of cases) {
			// oxlint-disable-next-line no-await-in-loop -- each published state is asserted before the next replaces it.
			await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, error: error(code) }))
			expect(host.textContent).toContain(text)
		}

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: [message("u1", "user", "Full", "completed")],
				error: error("chat-conversation-too-long", { newChatAvailable: true }),
			}),
		)
		expect(host.textContent).toContain("conversation is full")
		expect(host.querySelectorAll("button[aria-label='New chat']").length).toBe(2)
	})

	test("offers new chat when a revoked stored session has no loadable messages", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: [],
			error: error("chat-session-unauthorized", { newChatAvailable: true }),
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const reset = host.querySelector<HTMLButtonElement>("button[aria-label='New chat']")
		expect(reset).not.toBeNull()
		await act(async () => reset?.click())
		expect(store.calls.newChat).toBe(1)
	})

	test("renders initialization, reset time, recovery, outcomes, and generic errors", async () => {
		const store = fakeClient({ ...READY_SNAPSHOT, initialization: "loading" })
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(host.textContent).toContain("Loading chat")
		expect(input().disabled).toBe(true)

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				generation: "recovery",
				recovery: "pending",
				retryAt: "2026-09-13T00:00:00Z",
				error: error("unknown-code"),
				messages: [
					message("a1", "assistant", "Failed", "failed"),
					message("a2", "assistant", "Blocked", "blocked"),
					message("a3", "assistant", "Interrupted", "interrupted"),
				],
			}),
		)
		expect(host.textContent).toContain("Recovering response")
		expect(host.textContent).toContain("Response failed")
		expect(host.textContent).toContain("Response blocked")
		expect(host.textContent).toContain("Response interrupted")
		expect(host.textContent).toContain("Something went wrong")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				retryAt: "2026-09-13T00:00:00Z",
				error: error("chat-daily-allowance-exceeded"),
			}),
		)
		expect(host.querySelector("time")?.dateTime).toBe("2026-09-13T00:00:00Z")
	})
})

test("preview presentation renders directly without a semantic client", async () => {
	using fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected preview request"))
	await render(<EmbeddedWidget title="Preview" appearance={{ theme: "light" }} />)
	await openChat()
	expect(host.querySelector("h2")?.textContent).toBe("Preview")
	expect(host.textContent).toContain("Hi there!")
	expect(fetchSpy).not.toHaveBeenCalled()
})
