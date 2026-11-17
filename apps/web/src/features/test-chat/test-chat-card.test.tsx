import type { ChatEvent, ChatTransport } from "@talqo/sdk"

import { act, createTestHarness, settle } from "@/testing/component-harness"
import { click, findButton, typeInto } from "@/testing/dom"
import { ChatTransportError, createChatClient } from "@talqo/sdk"
import { afterEach, describe, expect, test } from "bun:test"

const { TestChatCard } = await import("./test-chat-card")
const { t } = await import("i18next")

const AGENT_ID = "4d1f5e4e-6a8b-4c3e-9f0a-1b2c3d4e5f60"

type Harness = ReturnType<typeof createTestHarness>
let harness: Harness | undefined

afterEach(async () => {
	await harness?.dispose()
	harness = undefined
})

function gate() {
	let open!: () => void
	const opened = new Promise<void>((resolve) => {
		open = resolve
	})
	return { opened, open }
}

function accepted(): ChatEvent {
	return {
		type: "accepted",
		requestId: "r1",
		generationId: "g1",
		userMessage: { id: "u1", createdAt: "2026-11-17T10:00:00.000Z" },
		assistantMessage: { id: "a1", createdAt: "2026-11-17T10:00:01.000Z" },
	}
}

function streamed(events: () => AsyncIterable<ChatEvent>): ChatTransport["sendMessage"] {
	return async () => events()
}

function transport(sendMessage: ChatTransport["sendMessage"], cancels: string[] = []): ChatTransport {
	return {
		loadConfiguration: async () => ({ title: "", appearance: {}, isAvailable: true }),
		loadSession: async () => ({ messages: [], activeGeneration: undefined }),
		sendMessage,
		cancelResponse: async (input) => {
			cancels.push(input.credential)
		},
	}
}

async function render(chatTransport: ChatTransport): Promise<HTMLElement> {
	harness = createTestHarness()
	const { host, root } = harness
	await act(async () =>
		root.render(
			<TestChatCard
				agentId={AGENT_ID}
				createClient={() => createChatClient({ apiUrl: "http://localhost", transport: chatTransport })}
			/>,
		),
	)
	await settle()
	return host
}

function composer(host: HTMLElement): HTMLTextAreaElement {
	const input = host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t("testChat.messageLabel")}"]`)
	if (!input) throw new Error("composer not rendered")
	return input
}

async function pressEnter(input: HTMLTextAreaElement): Promise<void> {
	await act(async () => {
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
	})
	await settle()
	await settle()
}

describe("TestChatCard", () => {
	test("sends on Enter, streams the reply, and clears the draft once accepted", async () => {
		const host = await render(
			transport(
				streamed(async function* () {
					yield accepted()
					yield { type: "delta", assistantMessageId: "a1", text: "Hello **there**" }
					yield { type: "terminal", outcome: "completed" }
				}),
			),
		)
		expect(host.textContent).toContain(t("testChat.empty"))

		await typeInto(composer(host), "Do you ship abroad?")
		await pressEnter(composer(host))

		expect(host.textContent).toContain(t("testChat.you"))
		expect(host.textContent).toContain("Do you ship abroad?")
		expect(host.querySelector("strong")?.textContent).toBe("there")
		expect(composer(host).value).toBe("")
	})

	test("keeps the draft and names the recovery step when the provider is unavailable", async () => {
		const host = await render(
			transport(async () => {
				throw new ChatTransportError({ code: "provider-error", status: 502 })
			}),
		)

		await typeInto(composer(host), "Hello")
		await click(findButton(t("testChat.send"), host))

		expect(host.querySelector("[role=alert]")?.textContent).toContain(t("testChat.errorProvider"))
		expect(composer(host).value).toBe("Hello")
	})

	test("explains lost access instead of a generic failure", async () => {
		const host = await render(
			transport(async () => {
				throw new ChatTransportError({ code: "invalid-response", status: 403 })
			}),
		)

		await typeInto(composer(host), "Hello")
		await click(findButton(t("testChat.send"), host))

		expect(host.querySelector("[role=alert]")?.textContent).toContain(t("testChat.errorAccess"))
	})

	test("stops a running answer and starts a new chat afterwards", async () => {
		const cancels: string[] = []
		const release = gate()
		const host = await render(
			transport(
				streamed(async function* () {
					yield accepted()
					await release.opened
					yield { type: "terminal", outcome: "cancelled" }
				}),
				cancels,
			),
		)
		await typeInto(composer(host), "Hello")
		await click(findButton(t("testChat.send"), host))

		await click(findButton(t("testChat.stop"), host))
		release.open()
		await settle()
		await settle()

		expect(cancels).toHaveLength(1)
		expect(host.textContent).toContain(t("conversations.outcomeCancelled"))
		await click(findButton(t("testChat.newChat"), host))
		expect(host.textContent).toContain(t("testChat.empty"))
	})

	test("offers a retry beside a failed answer", async () => {
		let sends = 0
		const host = await render(
			transport(
				streamed(async function* () {
					sends += 1
					yield accepted()
					yield {
						type: "error",
						outcome: "failed",
						error: { code: "provider-error", retriable: true, newChatAvailable: false },
					}
				}),
			),
		)
		await typeInto(composer(host), "Hello")
		await click(findButton(t("testChat.send"), host))

		await click(findButton(t("testChat.retry"), host))

		expect(sends).toBe(2)
	})
})
