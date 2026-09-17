import type { ChatClient, ChatError, ChatErrorCode, ChatMessage, ChatSnapshot } from "@talqo/sdk"
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
	const calls = { cancel: 0, initialize: 0, newChat: 0, retry: 0, sends: [] as string[] }
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
		async retryLastMessage() {
			calls.retry += 1
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

function error(code: ChatErrorCode, overrides: Partial<ChatError> = {}): ChatError {
	return { code, ...overrides }
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
		const stop = host.querySelector<HTMLButtonElement>("button[aria-label='Stop generating']")
		expect(stop?.closest("form")).not.toBeNull()
		expect(stop?.type).toBe("button")
		expect(stop?.textContent).toBe("")
		expect(stop?.querySelector("svg")).not.toBeNull()
		expect(host.querySelector("form button[type='submit']")).toBeNull()
		await act(async () => stop?.click())
		expect(store.calls.cancel).toBe(1)

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part", "cancelled")],
			}),
		)
		expect(host.textContent).toContain("Response cancelled")
	})

	test("shows an accessible animated response indicator only until text arrives", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			generation: "sending",
			messages: [message("u1", "user", "Hello", "completed")],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const indicator = host.querySelector<HTMLElement>("[role='status']")
		expect(indicator?.textContent).toBe("Agent is responding")
		const dots = indicator?.querySelectorAll("[aria-hidden='true'] > span")
		expect(dots).toHaveLength(3)
		for (const dot of dots ?? []) {
			expect(dot.className).toContain("tw:animate-bounce")
			expect(dot.className).toContain("tw:motion-reduce:animate-none")
		}

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				generation: "streaming",
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "", "streaming")],
			}),
		)
		expect(host.querySelectorAll("[role='status']")).toHaveLength(1)

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				generation: "streaming",
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Answer", "streaming")],
			}),
		)
		expect(host.querySelector("[role='status']")).toBeNull()
		expect(host.textContent).toContain("Answer")
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
		expect(button?.title).toBe("Start a new chat and clear this conversation")
		expect(button?.querySelector("svg")).not.toBeNull()
		expect(button?.textContent).toBe("")
		for (const control of host.querySelectorAll("header button")) {
			expect(control.className).toContain("tw:size-6")
			expect(control.className).toContain("tw:items-center")
			expect(control.className).toContain("tw:justify-center")
		}
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
			store.setSnapshot({ ...READY_SNAPSHOT, messages: history, error: error("reset-failed") })
			throw new Error("failed")
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("unsent")
		await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label='New chat']")?.click())

		expect(host.textContent).toContain("Keep history")
		expect(host.textContent).toContain("new chat could not be started")
		expect(input().value).toBe("unsent")
	})

	test("renders every stable error code without a generic fallback", async () => {
		const cases = [
			["invalid-request", "message could not be accepted"],
			["malformed-json", "invalid request data"],
			["chat-client-address-unavailable", "cannot verify this network"],
			["chat-conversation-too-long", "conversation is full"],
			["chat-daily-allowance-exceeded", "network's daily message allowance"],
			["chat-concurrency-limit", "Too many responses are being generated"],
			["chat-session-busy", "This conversation already has a response"],
			["chat-request-conflict", "conflicts with an earlier message"],
			["chat-session-unauthorized", "session is invalid or has been revoked"],
			["chat-context-limit", "conversation exceeds the model context limit"],
			["chat-input-incompatible", "message is incompatible with the configured model"],
			["payload-too-large", "message is too large"],
			["provider-error", "response could not be completed"],
			["internal-server-error", "chat service encountered an internal error"],
			["embed-not-found", "embed is unavailable or invalid"],
			["request-failed", "chat request failed"],
			["invalid-response", "chat service returned an invalid response"],
			["storage-unavailable", "cannot be restored after a reload"],
			["transport-error", "connection to chat failed"],
			["cancel-failed", "response could not be stopped"],
			["reset-failed", "new chat could not be started"],
		] as const satisfies readonly (readonly [ChatErrorCode, string])[]
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
				error: error("chat-conversation-too-long"),
			}),
		)
		expect(host.textContent).toContain("conversation is full")
		expect(host.querySelectorAll("button[aria-label='New chat']").length).toBe(2)
		expect(host.querySelector("[role='alert']")?.className).toContain("tw:bg-destructive/10")
		expect(host.querySelector("[role='alert']")?.className).toContain("tw:text-destructive")
	})

	test("offers an explicit retry only for a retriable failed turn", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "", "failed")],
			error: error("provider-error", { retriable: true }),
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const retry = host.querySelector<HTMLButtonElement>("button[aria-label='Retry']")
		expect(retry).not.toBeNull()
		await act(async () => retry?.click())
		expect(store.calls.retry).toBe(1)

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				reset: "resetting",
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "", "failed")],
				error: error("provider-error", { retriable: true }),
			}),
		)
		expect(host.querySelector<HTMLButtonElement>("button[aria-label='Retry']")?.disabled).toBe(true)

		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, error: error("provider-error") }))
		expect(host.querySelector("button[aria-label='Retry']")).toBeNull()
	})

	test("renders recovery and storage errors with fixed translucent red styling", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			persistence: "memory",
			recovery: "unavailable",
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const notices = Array.from(host.querySelectorAll<HTMLElement>("p")).filter(
			(element) =>
				element.textContent?.includes("recovery is unavailable") ||
				element.textContent?.includes("cannot be restored after a reload"),
		)
		expect(notices).toHaveLength(2)
		for (const notice of notices) {
			expect(notice.className).toContain("tw:bg-destructive/10")
			expect(notice.className).toContain("tw:text-destructive")
		}
	})

	test("offers new chat when a revoked stored session has no loadable messages", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			initialization: "error",
			messages: [],
			error: error("chat-session-unauthorized"),
		})
		store.onInitialize(async () => {
			throw new Error("revoked")
		})
		store.onNewChat(async () => store.setSnapshot(READY_SNAPSHOT))
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("keep draft")

		const reset = host.querySelector<HTMLButtonElement>("button[aria-label='New chat']")
		expect(reset).not.toBeNull()
		expect(reset?.disabled).toBe(false)
		await act(async () => reset?.click())
		expect(store.calls.newChat).toBe(1)
		expect(input().value).toBe("keep draft")
		expect(input().disabled).toBe(false)
	})

	test("renders initialization, reset time, recovery, outcomes, and protocol errors", async () => {
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
				error: error("invalid-response"),
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
		expect(host.textContent).toContain("chat service returned an invalid response")

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
