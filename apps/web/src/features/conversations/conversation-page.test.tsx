import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConversationPage } = await import("./conversation-page")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } = await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const AGENT = { id: "11111111-1111-4111-8111-111111111111", name: "Shop helper" }
const CONVERSATION_ID = "77777777-0000-4000-8000-000000000001"
const TRANSCRIPT_URL = `/api/conversations/${CONVERSATION_ID}`
const PROBLEM_TYPE = "https://docs.talqo.chat/problems#"

let transcript: () => Promise<Response>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function problem(code: string, status: number): Response {
	return json({ code, type: `${PROBLEM_TYPE}${code}` }, status)
}

const found = () =>
	json({
		conversation: {
			id: CONVERSATION_ID,
			agentId: AGENT.id,
			startedAt: "2026-10-01T10:00:00.000Z",
			messages: [
				{
					id: "1",
					role: "user",
					text: "Where is my order?",
					outcome: "completed",
					createdAt: "2026-10-01T10:00:00.000Z",
				},
			],
		},
	})

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPage() {
	const rootRoute = createRootRoute({
		component: () => <ConversationPage conversationId={CONVERSATION_ID} listSearch={{ page: 2 }} />,
	})
	const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory() })
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<RouterProvider router={router} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
	await settle()
}

function alertText(): string | null | undefined {
	return host.querySelector("[role=alert]")?.textContent
}

beforeEach(() => {
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url === "/api/agents") return json({ agents: [AGENT] })
		if (url === TRANSCRIPT_URL) return transcript()
		throw new Error(`unexpected request ${url}`)
	}) as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	queryClient.clear()
	mock.restore()
})

describe("ConversationPage", () => {
	test("announces loading, then shows the transcript with its agent", async () => {
		const pending = Promise.withResolvers<Response>()
		transcript = () => pending.promise

		await renderPage()
		expect(host.querySelector("output")?.textContent).toBe(t("conversations.loadingTranscript"))

		await act(async () => pending.resolve(found()))
		await settle()

		expect(host.querySelector("h1")?.textContent).toBe("Where is my order?")
		expect(host.textContent).toContain("Where is my order?")
		expect(host.textContent).toContain(AGENT.name)
	})

	test("returns to the list page the operator came from", async () => {
		transcript = async () => found()

		await renderPage()

		const back = [...host.querySelectorAll("a")].find(
			(link) => link.textContent === t("conversations.backToConversations"),
		)
		expect(back?.getAttribute("href")).toBe("/dashboard/conversations?page=2")
	})

	test("says a missing conversation no longer exists, without a pointless retry", async () => {
		transcript = async () => problem("conversation-not-found", 404)

		await renderPage()

		expect(alertText()).toBe(t("problems.conversation-not-found"))
		expect(host.textContent).not.toContain(t("common.retry"))
	})

	test("offers a retry when loading fails", async () => {
		let attempts = 0
		transcript = async () => {
			attempts += 1
			return attempts === 1 ? problem("internal-server-error", 500) : found()
		}

		await renderPage()
		expect(alertText()).toBe(t("problems.internal-server-error"))

		const retry = [...host.querySelectorAll("button")].find((element) => element.textContent === t("common.retry"))
		await act(async () => retry?.click())
		await settle()

		expect(alertText()).toBeUndefined()
		expect(host.textContent).toContain("Where is my order?")
	})
})
