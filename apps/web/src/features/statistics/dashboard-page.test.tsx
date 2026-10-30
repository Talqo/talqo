import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"

import type { DashboardSearch } from "./dashboard-page"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { DashboardIndexPage } = await import("./dashboard-page")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act, useState } = await import("react")
const { t } = await import("i18next")

const AGENT = {
	id: "agent-1",
	name: "Shop helper",
	createdAt: "2026-10-20T00:00:00.000Z",
	updatedAt: "2026-10-20T00:00:00.000Z",
	permissions: ["stats:read"],
}

let requested: string[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

function emptyOverview(days: number) {
	return {
		overview: {
			days,
			totals: { conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0 },
			daily: [],
			agentDaily: [],
			agents: [],
			active: [],
			activeWindowMinutes: 5,
		},
	}
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function Harness({ initial }: { initial: DashboardSearch }) {
	const [search, setSearch] = useState<DashboardSearch>(initial)
	return <DashboardIndexPage search={search} onSearchChange={setSearch} />
}

async function renderPage(initial: DashboardSearch) {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<Harness initial={initial} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
	await settle()
	await settle()
}

beforeEach(() => {
	requested = []
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		requested.push(url)
		if (url === "/api/me/permissions") return json({ permissions: ["admin"] })
		if (url === "/api/agents") return json({ agents: [AGENT] })
		if (url === "/api/stats?days=7") return json(emptyOverview(7))
		if (url === "/api/stats?days=all") return json(emptyOverview(0))
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

test("keeps both filters visible and offers all time when a range has no conversations", async () => {
	await renderPage({ days: 7 })

	expect(host.textContent).toContain(t("dashboard.emptyRange", { range: t("dashboard.range7d") }))
	expect(host.textContent).toContain(t("dashboard.agentsLabel"))
	expect(host.textContent).toContain(t("dashboard.rangeLabel"))
	expect(requested).toContain("/api/stats?days=7")

	const allTime = host.querySelector<HTMLButtonElement>('[data-slot="empty-state"] button')
	if (!allTime) throw new Error("all time action not rendered")
	expect(allTime.textContent?.trim()).toBe(t("dashboard.rangeAll"))
	await act(async () => allTime.click())
	await settle()
	await settle()

	expect(requested).toContain("/api/stats?days=all")
	expect(host.textContent).toContain(t("dashboard.emptyAll"))
	expect(host.textContent).toContain(t("dashboard.agentsLabel"))
	expect(host.textContent).toContain(t("dashboard.rangeLabel"))
	expect(host.querySelectorAll('[data-slot="empty-state"] button')).toHaveLength(0)
})
