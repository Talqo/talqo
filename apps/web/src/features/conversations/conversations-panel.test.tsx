import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

// bun runs every test file in one process; only the first may register the DOM.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConversationsPanel } = await import("./conversations-panel")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } = await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const AGENT_ID = "11111111-1111-4111-8111-111111111111"
const LIST_URL = `/api/agents/${AGENT_ID}/conversations`

function summary(id: string, preview: string | null) {
	return { id, startedAt: "2026-10-01T10:00:00.000Z", messageCount: 2, preview }
}

let pages: Record<string, Response | (() => Response)>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPanel() {
	const rootRoute = createRootRoute({ component: () => <ConversationsPanel agentId={AGENT_ID} /> })
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
	await settle()
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find((element) => element.textContent === label)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

beforeEach(() => {
	pages = {}
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const page = pages[String(input)]
		if (!page) throw new Error(`unexpected request ${String(input)}`)
		return typeof page === "function" ? page() : page.clone()
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

describe("ConversationsPanel", () => {
	test("explains where conversations come from when there are none", async () => {
		pages[LIST_URL] = json({ conversations: [], nextCursor: null })

		await renderPanel()

		expect(host.textContent).toContain(t("conversations.empty"))
	})

	test("links each conversation to its transcript and loads older pages on demand", async () => {
		const older = "22222222-2222-4222-8222-222222222222"
		pages[LIST_URL] = json({ conversations: [summary("first", "Where is my order?")], nextCursor: "first" })
		pages[`${LIST_URL}?before=first`] = json({ conversations: [summary(older, null)], nextCursor: null })

		await renderPanel()
		const link = host.querySelector("a")
		expect(link?.getAttribute("href")).toBe(`/dashboard/agent/${AGENT_ID}/conversations/first`)
		expect(host.textContent).toContain("Where is my order?")

		await act(async () => button(t("conversations.loadMore")).click())
		await settle()

		expect(host.textContent).toContain(t("conversations.noPreview"))
		expect(host.querySelectorAll("li")).toHaveLength(2)
		expect(host.textContent).not.toContain(t("conversations.loadMore"))
	})

	test("offers a retry when loading fails", async () => {
		let attempts = 0
		pages[LIST_URL] = () => {
			attempts += 1
			return attempts === 1
				? json({ code: "internal-server-error", type: "https://docs.talqo.chat/problems#internal-server-error" }, 500)
				: json({ conversations: [summary("first", "Hello")], nextCursor: null })
		}

		await renderPanel()
		expect(host.querySelector("[role=alert]")?.textContent).toBe(t("problems.internal-server-error"))

		await act(async () => button(t("conversations.retry")).click())
		await settle()

		expect(host.textContent).toContain("Hello")
	})
})
