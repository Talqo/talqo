import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

// Component test files share one process, so only the first one registers the DOM.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { McpConnectionsCard } = await import("./mcp-connections-card")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })
}

async function respond(input: RequestInfo | URL): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	if (url === "/api/agents/agent-1/mcp-servers") return json({ servers: [], stdioAllowed: false })
	throw new Error(`unexpected request ${url}`)
}

async function renderCard(canManage: boolean) {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<McpConnectionsCard agentId="agent-1" canManage={canManage} />
				</LanguageProvider>
			</QueryClientProvider>,
		),
	)
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function addButtons(): HTMLButtonElement[] {
	return [...host.querySelectorAll("button")].filter((element) => element.textContent?.trim() === t("mcp.add"))
}

beforeEach(() => {
	spyOn(globalThis, "fetch").mockImplementation(respond as typeof fetch)
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

describe("McpConnectionsCard empty state", () => {
	test("invites a manager to add the first connection", async () => {
		await renderCard(true)

		expect(host.textContent).toContain(t("mcp.emptyTitle"))
		expect(host.textContent).toContain(t("mcp.emptyDescriptionManager"))
		expect(addButtons()).toHaveLength(2)
	})

	test("does not offer adding to a reader", async () => {
		await renderCard(false)

		expect(host.textContent).toContain(t("mcp.emptyDescriptionReader"))
		expect(host.textContent).not.toContain(t("mcp.emptyDescriptionManager"))
		expect(addButtons()).toHaveLength(0)
	})
})
