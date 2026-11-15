import type { ChatClient, ChatError, ChatErrorCode, ChatMessage, ChatSnapshot } from "@talqo/sdk"
import type { Root } from "react-dom/client"

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

await import("./test-setup")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConnectedEmbeddedWidget, EmbeddedWidget } = await import("./embedded-widget")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

const READY_SNAPSHOT: ChatSnapshot = {
	isAvailable: true,
	configuration: {
		title: "SDK support",
		appearance: {
			theme: "light",
			light: { primary: "#123456", background: "#fefefe" },
		},
		isAvailable: true,
	},
	messages: [],
	activity: "idle",
	actions: ["send", "new-chat"],
	notices: [],
	acceptedMessageId: undefined,
	activeTools: [],
	error: undefined,
}

const noopAction = async () => {}

function fakeClient(initial: ChatSnapshot = READY_SNAPSHOT) {
	let snapshot = initial
	const listeners = new Set<() => void>()
	const calls = { cancel: 0, dispose: 0, initialize: 0, newChat: 0, retry: 0, sends: [] as string[] }
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
		dispose() {
			calls.dispose += 1
		},
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
	const event = new Event("submit", { bubbles: true, cancelable: true })
	await act(async () => host.querySelector("form")?.dispatchEvent(event))
	return event
}

function sendButton(): HTMLButtonElement | null {
	return host.querySelector<HTMLButtonElement>("form button[type='submit']")
}

function headerNewChat(): HTMLButtonElement | null {
	return host.querySelector<HTMLButtonElement>("dialog header button[aria-label='New chat']")
}

function errorPanelNewChat(): HTMLButtonElement | null {
	return (
		[...host.querySelectorAll<HTMLButtonElement>("button[aria-label='New chat']")].find(
			(button) => button.textContent?.length,
		) ?? null
	)
}

function transcript(): HTMLElement {
	const element = host.querySelector<HTMLElement>(".talqo-scrollbar")
	if (!element) throw new Error("transcript scroll area not rendered")
	return element
}

function announcement(): Element | null {
	return host.querySelector("[data-testid='announcement']")
}

function mockScrollMetrics(element: HTMLElement, metrics: { scrollHeight: number; clientHeight: number }) {
	Object.defineProperty(element, "scrollHeight", { configurable: true, get: () => metrics.scrollHeight })
	Object.defineProperty(element, "clientHeight", { configurable: true, get: () => metrics.clientHeight })
}

async function scrollTo(top: number) {
	await act(async () => {
		transcript().scrollTop = top
		transcript().dispatchEvent(new Event("scroll", { bubbles: true }))
	})
}

function retriableFailure() {
	return fakeClient({
		...READY_SNAPSHOT,
		messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "", "failed")],
		error: error("provider-error", { retriable: true }),
		actions: ["send", "retry", "new-chat"],
	})
}

async function renderStreamingWidget() {
	const store = fakeClient({
		...READY_SNAPSHOT,
		activity: "responding",
		messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part", "streaming")],
	})
	await render(<ConnectedEmbeddedWidget client={store.client} />)
	await openChat()
	mockScrollMetrics(transcript(), { scrollHeight: 1000, clientHeight: 300 })
	return store
}

async function renderRespondingWidget() {
	const store = fakeClient({
		...READY_SNAPSHOT,
		activity: "responding",
		actions: ["stop", "new-chat"],
		messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part", "streaming")],
	})
	await render(<ConnectedEmbeddedWidget client={store.client} />)
	await openChat()
	return store
}

async function growTranscript(store: ReturnType<typeof fakeClient>) {
	mockScrollMetrics(transcript(), { scrollHeight: 1200, clientHeight: 300 })
	await act(async () =>
		store.setSnapshot({
			...READY_SNAPSHOT,
			activity: "responding",
			messages: [
				message("u1", "user", "Hello", "completed"),
				message("a1", "assistant", "Part one and part two", "streaming"),
			],
		}),
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
		const store = await renderRespondingWidget()

		expect(host.textContent).toContain("Part")
		const stop = host.querySelector<HTMLButtonElement>("button[aria-label='Stop generating']")
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

	test("renders an empty cancelled assistant response as a status without a bubble", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "", "cancelled")],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const status = [...host.querySelectorAll("span")].find((element) => element.textContent === "Response cancelled")
		const bubble = status?.closest<HTMLElement>("[data-slot='bubble']")
		expect(bubble?.dataset.align).toBe("start")
		expect(bubble?.querySelector("[data-slot='bubble-content']")).toBeNull()
	})

	test("does not render assistant outcome labels on interrupted user messages", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: [message("u1", "user", "Hello", "interrupted")],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		expect(host.textContent).toContain("Hello")
		expect(host.textContent).not.toContain("Response interrupted")
	})

	test("shows an accessible animated response indicator only until text arrives", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			activity: "sending",
			messages: [message("u1", "user", "Hello", "completed")],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const indicator = host.querySelector<HTMLOutputElement>("[data-slot='bubble-content'] output")
		expect(indicator?.textContent).toBe("Agent is responding")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				activity: "responding",
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "", "streaming")],
			}),
		)
		expect(host.querySelectorAll("[data-slot='bubble-content'] output")).toHaveLength(1)
		expect(host.querySelector("[data-slot='bubble-content'] output")?.textContent).toBe("Agent is responding")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				activity: "responding",
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Answer", "streaming")],
			}),
		)
		expect(host.querySelector("[data-slot='bubble-content'] output")).toBeNull()
		expect(host.textContent).toContain("Answer")
	})

	test("trims sends, prevents duplicate submissions, and clears only after SDK acceptance", async () => {
		const store = fakeClient()
		let finish!: () => void
		store.onSend(() => {
			store.setSnapshot({ ...READY_SNAPSHOT, activity: "sending", actions: ["stop", "new-chat"] })
			return new Promise<void>((resolve) => {
				finish = resolve
			})
		})
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
				activity: "responding",
				acceptedMessageId: "u1",
				messages: [message("u1", "user", "hello", "completed")],
			}),
		)
		expect(input().value).toBe("")
		await act(async () => finish())
	})

	test("rejects empty input and retains a failed send's draft until SDK acceptance", async () => {
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
		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, acceptedMessageId: "recovered-user" }))
		expect(input().value).toBe("")
	})

	test("keeps the composer editable and focused while the agent responds", async () => {
		const store = await renderRespondingWidget()

		expect(input().disabled).toBe(false)
		expect(document.activeElement).toBe(input())
		expect(host.querySelector("button[aria-label='Stop generating']")).not.toBeNull()

		await draft("next thought")
		expect(input().value).toBe("next thought")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				activity: "responding",
				actions: ["stop", "new-chat"],
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part two", "streaming")],
			}),
		)
		expect(input().value).toBe("next thought")
		expect(document.activeElement).toBe(input())

		await submit()
		expect(store.calls.sends).toEqual([])
		expect(input().value).toBe("next thought")
	})

	test("announces a completed response, not each streamed delta", async () => {
		const store = await renderRespondingWidget()

		expect(announcement()?.textContent).toBe("")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				activity: "responding",
				actions: ["stop", "new-chat"],
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part two", "streaming")],
			}),
		)
		expect(announcement()?.textContent).toBe("")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part two", "completed")],
			}),
		)
		expect(announcement()?.textContent).toBe("Response complete.")
	})

	test("tells the end user administrators may review the chat before they write", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const noticeId = input().getAttribute("aria-describedby")
		const notice = noticeId ? host.querySelector(`[id="${noticeId}"]`) : null
		expect(notice?.textContent).toBe("This chat may be reviewed by administrators.")
		expect(transcript().firstElementChild).toBe(notice)
	})

	test("labels transcript items by role in a silent named log", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Hi", "completed")],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const log = host.querySelector("[role='log']")
		expect(log?.getAttribute("aria-label")).toBe("Conversation")
		expect(log?.getAttribute("aria-live")).toBe("off")
		const items = [...host.querySelectorAll("[data-slot='bubble']")]
		const user = items.find((element) => element.textContent?.includes("Hello"))
		const agent = items.find((element) => element.textContent?.includes("Hi"))
		expect(user?.textContent ?? "").toContain("You")
		expect(agent?.textContent ?? "").toContain("Agent")
	})

	test("shows one daily allowance reset formatted in the widget language", async () => {
		const retryAt = "2026-09-13T00:00:00Z"
		const store = fakeClient({
			...READY_SNAPSHOT,
			error: error("chat-daily-allowance-exceeded", { retryAt }),
		})
		await render(<ConnectedEmbeddedWidget client={store.client} appearance={{ language: "cs" }} />)
		await act(async () => {})
		await openChat()

		const expected = new Intl.DateTimeFormat("cs", { dateStyle: "medium", timeStyle: "short" }).format(
			new Date(retryAt),
		)
		const time = host.querySelector("time")
		expect(time?.dateTime).toBe(retryAt)
		expect(time?.textContent).toBe(`Zkuste to znovu po ${expected}.`)
		expect(host.textContent?.match(/Zkuste to znovu po/g)).toHaveLength(1)
	})

	test("omits the reset line when retryAt is not a date", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			error: error("chat-daily-allowance-exceeded", { retryAt: "raw-retry-value" }),
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		expect(host.textContent).toContain("daily message allowance")
		expect(host.querySelector("time")).toBeNull()
	})

	test("offers new chat for any conversation, preserving draft and focusing after success", async () => {
		const store = fakeClient({ ...READY_SNAPSHOT, messages: [message("u1", "user", "History", "completed")] })
		store.onNewChat(async () => store.setSnapshot(READY_SNAPSHOT))
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("unsent")

		const button = host.querySelector<HTMLButtonElement>("button[aria-label='New chat']")
		expect(button?.title).toBe("Start a new chat and clear this conversation")
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

	test("renders representative error codes with a recovery path for a full conversation", async () => {
		const cases = [
			["provider-error", "response could not be completed"],
			["chat-conversation-too-long", "conversation is full"],
			["transport-error", "connection to chat failed"],
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
				error: error("chat-conversation-too-long", { newChatAvailable: true }),
			}),
		)
		expect(host.textContent).toContain("conversation is full")
		expect(host.querySelectorAll("button[aria-label='New chat']").length).toBe(2)
	})

	test("SDK availability hides an open widget and restores its launcher", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(host.querySelector("dialog[open]")).not.toBeNull()
		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, isAvailable: false }))
		expect(host.childElementCount).toBe(0)
		await act(async () => store.setSnapshot(READY_SNAPSHOT))
		expect(host.querySelector("button[aria-haspopup=dialog]")).not.toBeNull()
	})

	test("offers an explicit retry only for a retriable failed turn", async () => {
		const store = retriableFailure()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const retry = host.querySelector<HTMLButtonElement>("button[aria-label='Retry']")
		expect(retry).not.toBeNull()
		expect(retry?.textContent).toBe("Retry")
		await act(async () => retry?.click())
		expect(store.calls.retry).toBe(1)

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				activity: "resetting",
				actions: [],
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "", "failed")],
				error: error("provider-error", { retriable: true }),
			}),
		)
		expect(host.querySelector<HTMLButtonElement>("button[aria-label='Retry']")?.disabled).toBe(true)

		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, error: error("provider-error") }))
		expect(host.querySelector("button[aria-label='Retry']")).toBeNull()
	})

	test("renders recovery and storage error notices", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			notices: ["storage-unavailable", "recovery-unavailable"],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const notices = Array.from(host.querySelectorAll<HTMLElement>("[role='alert'], output")).filter(
			(element) =>
				element.textContent?.includes("recovery is unavailable") ||
				element.textContent?.includes("cannot be restored after a reload"),
		)
		expect(notices).toHaveLength(2)
	})

	test("offers new chat when a revoked stored session has no loadable messages", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			activity: "blocked",
			actions: ["new-chat"],
			messages: [],
			error: error("chat-session-unauthorized", { newChatAvailable: true }),
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

	test("keeps the composer editable and focused while initializing", async () => {
		const store = fakeClient({ ...READY_SNAPSHOT, activity: "loading", actions: [] })
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(host.textContent).toContain("Loading chat")
		expect(input().disabled).toBe(false)
		expect(document.activeElement).toBe(input())
		expect(host.querySelector<HTMLButtonElement>("form button[type='submit']")?.disabled).toBe(true)
	})

	test("enables sending only for a non-blank draft the SDK accepts", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		expect(input().value).toBe("")
		expect(input().placeholder).toBe("Type a message…")
		expect(sendButton()?.getAttribute("aria-label")).toBe("Send")
		expect(sendButton()?.disabled).toBe(true)

		await draft("hello")
		expect(sendButton()?.disabled).toBe(false)

		await draft("   ")
		expect(sendButton()?.disabled).toBe(true)

		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, actions: [] }))
		await draft("hello")
		expect(sendButton()?.disabled).toBe(true)
	})

	test("disables the composer only while the conversation is blocked", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			activity: "blocked",
			actions: ["new-chat"],
			error: error("chat-session-unauthorized", { newChatAvailable: true }),
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(input().disabled).toBe(true)

		await act(async () => store.setSnapshot(READY_SNAPSHOT))
		expect(input().disabled).toBe(false)
	})

	test("shows a disabled stopping control until the cancellation settles", async () => {
		const store = fakeClient({ ...READY_SNAPSHOT, activity: "stopping", actions: [] })
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const stop = host.querySelector<HTMLButtonElement>("button[aria-label='Stopping…']")
		expect(stop).not.toBeNull()
		expect(stop?.disabled).toBe(true)
		expect(sendButton()).toBeNull()
		expect(host.querySelector("button[aria-label='Stop generating']")).toBeNull()
	})

	test("prevents the page from reloading when a message is sent", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("hello")

		const event = await submit()
		expect(event.defaultPrevented).toBe(true)
		expect(store.calls.sends).toEqual(["hello"])
	})

	test("shows progress copy only for the matching activity", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		expect(host.textContent).not.toContain("Loading chat")
		expect(host.textContent).not.toContain("Recovering response")

		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, activity: "loading", actions: [] }))
		expect(host.textContent).toContain("Loading chat")
		expect(host.textContent).not.toContain("Recovering response")

		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, activity: "recovering" }))
		expect(host.textContent).not.toContain("Loading chat")
		expect(host.textContent).toContain("Recovering response")
	})

	test("shows the greeting only before the conversation starts", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()

		const greeting = host.querySelector("[data-slot='bubble']")
		expect(greeting?.textContent).toContain("Hi there!")
		expect(greeting?.textContent).toContain("Agent")

		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, activity: "loading", actions: [] }))
		expect(host.textContent).not.toContain("Hi there!")

		await act(async () =>
			store.setSnapshot({ ...READY_SNAPSHOT, messages: [message("u1", "user", "Hello", "completed")] }),
		)
		expect(host.textContent).not.toContain("Hi there!")
	})

	test("indicates tool use only while a tool is active", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(host.textContent).not.toContain("Using a tool")

		await act(async () =>
			store.setSnapshot({ ...READY_SNAPSHOT, activeTools: [{ serverName: "shop", toolName: "search" }] }),
		)
		expect(host.textContent).toContain("Using a tool")
	})

	test("shows new chat only after a conversation exists and only when the SDK allows it", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(headerNewChat()).toBeNull()

		const history = [message("u1", "user", "Hello", "completed")]
		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, messages: history }))
		expect(headerNewChat()?.disabled).toBe(false)

		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, messages: history, actions: ["send"] }))
		expect(headerNewChat()?.disabled).toBe(true)
	})

	test("does not announce outcomes from the loaded history", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Hi", "completed")],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(announcement()?.textContent).toBe("")
	})

	test("announces each terminal outcome by name and clears it on close", async () => {
		const store = await renderRespondingWidget()
		const history = [message("u1", "user", "Hello", "completed")]

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: [...history, message("a1", "assistant", "Part", "cancelled")],
			}),
		)
		expect(announcement()?.textContent).toBe("Response cancelled")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: [
					...history,
					message("a1", "assistant", "Part", "cancelled"),
					message("a2", "assistant", "", "streaming"),
				],
			}),
		)
		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: [
					...history,
					message("a1", "assistant", "Part", "cancelled"),
					message("a2", "assistant", "Nope", "failed"),
				],
			}),
		)
		expect(announcement()?.textContent).toBe("Response failed")

		await openChat() // close
		await openChat() // reopen
		expect(announcement()?.textContent).toBe("")
	})

	test("does not announce a response that finishes while the panel is closed", async () => {
		const store = await renderRespondingWidget()
		await openChat() // close
		expect(announcement()).toBeNull()

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part", "completed")],
			}),
		)
		await openChat() // reopen
		expect(announcement()?.textContent).toBe("")
	})

	test("preserves a draft the visitor edits after sending", async () => {
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
		await draft("first")
		await submit()
		await draft("second")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				acceptedMessageId: "u1",
				messages: [message("u1", "user", "first", "completed")],
			}),
		)
		expect(input().value).toBe("second")
		await act(async () => finish())
	})

	test("keeps the draft when the SDK restores an acceptance without a local send", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		await draft("unsent")

		await act(async () => store.setSnapshot({ ...READY_SNAPSHOT, acceptedMessageId: "restored" }))
		expect(input().value).toBe("unsent")
	})

	test("offers a labelled new chat from a conversation-full error only when allowed", async () => {
		const full = [message("u1", "user", "Hello", "completed")]
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: full,
			error: error("chat-conversation-too-long"),
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(errorPanelNewChat()).toBeNull()

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				messages: full,
				error: error("chat-conversation-too-long", { newChatAvailable: true }),
			}),
		)
		expect(errorPanelNewChat()?.textContent).toBe("New chat")
	})

	test("falls back to the default title when the SDK sends no configuration", async () => {
		const store = fakeClient({ ...READY_SNAPSHOT, configuration: undefined })
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(host.querySelector("h2")?.textContent).toBe("AI Chat")
	})

	test("retranslates when the SDK configuration changes language", async () => {
		const store = fakeClient()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(host.textContent).toContain("Hi there!")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				configuration: { title: "SDK support", appearance: { language: "cs" }, isAvailable: true },
			}),
		)
		await act(async () => {})

		expect(host.querySelector<HTMLElement>(".talqo-widget")?.getAttribute("lang")).toBe("cs")
		expect(host.textContent).toContain("Dobrý den!")
	})

	test("warns on initialization failure and disposes the client when it unmounts", async () => {
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		const store = fakeClient()
		store.onInitialize(async () => {
			throw new Error("offline")
		})

		const localHost = document.createElement("div")
		document.body.append(localHost)
		const localRoot = createRoot(localHost)
		await act(async () => localRoot.render(<ConnectedEmbeddedWidget client={store.client} />))
		await act(async () => {})

		expect(warning).toHaveBeenCalledWith("TalqoWidget: initialization failed", expect.any(Error))
		await act(async () => localRoot.unmount())
		expect(store.calls.dispose).toBe(1)
		localHost.remove()
	})

	test("renders outcome labels for failed, blocked, and interrupted turns", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: [
				message("a1", "assistant", "Failed", "failed"),
				message("a2", "assistant", "Blocked", "blocked"),
				message("a3", "assistant", "Interrupted", "interrupted"),
			],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(host.textContent).toContain("Response failed")
		expect(host.textContent).toContain("Response blocked")
		expect(host.textContent).toContain("Response interrupted")
	})

	test("renders recovery progress, protocol errors, and retry time", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			activity: "recovering",
			error: error("invalid-response"),
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		expect(host.textContent).toContain("Recovering response")
		expect(host.textContent).toContain("chat service returned an invalid response")

		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				error: error("chat-daily-allowance-exceeded", { retryAt: "2026-09-13T00:00:00Z" }),
			}),
		)
		expect(host.querySelector("time")?.dateTime).toBe("2026-09-13T00:00:00Z")
	})

	describe("assistant markdown", () => {
		test("renders assistant markdown to elements: strong, list, and code block", async () => {
			const store = fakeClient({
				...READY_SNAPSHOT,
				messages: [
					message("a1", "assistant", "Here is **bold** text.\n\n- one\n- two\n\n```js\nconst x = 1\n```", "completed"),
				],
			})
			await render(<ConnectedEmbeddedWidget client={store.client} />)
			await openChat()

			const bubble = host.querySelector("[data-slot='bubble-content']")
			expect(bubble?.querySelector("strong")?.textContent).toBe("bold")
			expect(bubble?.querySelectorAll("li")).toHaveLength(2)
			expect(bubble?.querySelector("pre code")?.textContent).toContain("const x = 1")
		})

		test("keeps user message text literal without interpreting markdown", async () => {
			const store = fakeClient({
				...READY_SNAPSHOT,
				messages: [message("u1", "user", "**not bold** and `not code`", "completed")],
			})
			await render(<ConnectedEmbeddedWidget client={store.client} />)
			await openChat()

			const bubble = host.querySelector("[data-align='end'] [data-slot='bubble-content']")
			expect(bubble?.textContent).toBe("**not bold** and `not code`")
			expect(bubble?.querySelector("strong")).toBeNull()
			expect(bubble?.querySelector("code")).toBeNull()
		})

		test("opens markdown links in a new tab with safe rel", async () => {
			const store = fakeClient({
				...READY_SNAPSHOT,
				messages: [message("a1", "assistant", "See [docs](https://example.com/docs).", "completed")],
			})
			await render(<ConnectedEmbeddedWidget client={store.client} />)
			await openChat()

			const link = host.querySelector<HTMLAnchorElement>("[data-slot='bubble-content'] a")
			expect(link?.getAttribute("href")).toBe("https://example.com/docs")
			expect(link?.target).toBe("_blank")
			expect(link?.rel).toContain("noopener")
			expect(link?.rel).toContain("noreferrer")
		})

		test("never renders raw HTML in assistant text as live elements", async () => {
			const store = fakeClient({
				...READY_SNAPSHOT,
				messages: [
					message(
						"a1",
						"assistant",
						'Before <img src=x onerror="alert(1)"> middle <script>alert(2)</script> after',
						"completed",
					),
				],
			})
			await render(<ConnectedEmbeddedWidget client={store.client} />)
			await openChat()

			const bubble = host.querySelector("[data-slot='bubble-content']")
			expect(bubble?.querySelector("img")).toBeNull()
			expect(bubble?.querySelector("script")).toBeNull()
			expect(bubble?.textContent).toContain("Before")
			expect(bubble?.textContent).toContain("after")
		})

		test("shows markdown images as links instead of fetching them", async () => {
			const store = fakeClient({
				...READY_SNAPSHOT,
				messages: [message("a1", "assistant", "![Size chart](https://example.com/chart.png)", "completed")],
			})
			await render(<ConnectedEmbeddedWidget client={store.client} />)
			await openChat()

			const bubble = host.querySelector("[data-slot='bubble-content']")
			expect(bubble?.querySelector("img")).toBeNull()
			const link = bubble?.querySelector("a")
			expect(link?.getAttribute("href")).toBe("https://example.com/chart.png")
			expect(link?.textContent).toBe("Size chart")
			expect(link?.rel).toContain("noreferrer")
		})
	})
})

describe("transcript autoscroll", () => {
	test("follows streamed text growth while pinned", async () => {
		const store = await renderStreamingWidget()
		await scrollTo(700)

		await growTranscript(store)

		expect(transcript().scrollTop).toBe(1200)
	})

	test("leaves a scrolled-up visitor alone while the response streams", async () => {
		const store = await renderStreamingWidget()
		await scrollTo(0)

		await growTranscript(store)

		expect(transcript().scrollTop).toBe(0)
	})

	test("sending re-pins a scrolled-up visitor so the new message is visible", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: [message("u1", "user", "First", "completed")],
		})
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		mockScrollMetrics(transcript(), { scrollHeight: 1000, clientHeight: 300 })
		await scrollTo(0)

		await draft("second")
		await submit()
		mockScrollMetrics(transcript(), { scrollHeight: 1400, clientHeight: 300 })
		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				acceptedMessageId: "u2",
				messages: [message("u1", "user", "First", "completed"), message("u2", "user", "second", "completed")],
			}),
		)

		expect(transcript().scrollTop).toBe(1400)
	})

	test("stays pinned exactly at the sticky threshold", async () => {
		const store = await renderStreamingWidget()
		// 1000 - 652 - 300 = 48, the last pixel row that still counts as the bottom.
		await scrollTo(652)

		await growTranscript(store)

		expect(transcript().scrollTop).toBe(1200)
	})

	test("retrying re-pins a scrolled-up visitor so the new response is visible", async () => {
		const store = retriableFailure()
		await render(<ConnectedEmbeddedWidget client={store.client} />)
		await openChat()
		mockScrollMetrics(transcript(), { scrollHeight: 1000, clientHeight: 300 })
		await scrollTo(0)

		await act(async () => host.querySelector<HTMLButtonElement>("button[aria-label='Retry']")?.click())
		mockScrollMetrics(transcript(), { scrollHeight: 1400, clientHeight: 300 })
		await act(async () =>
			store.setSnapshot({
				...READY_SNAPSHOT,
				activity: "responding",
				actions: ["stop", "new-chat"],
				messages: [message("u1", "user", "Hello", "completed"), message("a1", "assistant", "Part", "streaming")],
			}),
		)

		expect(transcript().scrollTop).toBe(1400)
	})

	test("opening the panel pins the newest message", async () => {
		const store = fakeClient({
			...READY_SNAPSHOT,
			messages: Array.from({ length: 12 }, (_, index) =>
				message(`m${index}`, index % 2 === 0 ? "user" : "assistant", `Message ${index}`, "completed"),
			),
		})
		const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight")
		const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")
		Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 1000 })
		Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 300 })
		try {
			await render(<ConnectedEmbeddedWidget client={store.client} />)
			await openChat()
			await scrollTo(0)

			await openChat() // close
			await openChat() // reopen

			expect(transcript().scrollTop).toBe(1000)
		} finally {
			if (scrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight)
			else Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight")
			if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight)
			else Reflect.deleteProperty(HTMLElement.prototype, "clientHeight")
		}
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
