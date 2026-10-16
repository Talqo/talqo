import type { AgentFile } from "@/api/generated/models/agentFile.zod"
import type { Embed } from "@/api/generated/models/embed.zod"
import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { Root } from "react-dom/client"

import { EMBED_FORM_DEFAULTS } from "@/features/embeds/embed-appearance-form"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { AgentCardSummary } = await import("./agent-card-summary")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let files: AgentFile[]
let servers: McpServer[]
let embeds: Embed[]
let filesResponse: Promise<Response> | undefined
let requests: string[]

function json(body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
}

async function respond(input: RequestInfo | URL): Promise<Response> {
	const url = String(input)
	requests.push(url)
	if (url === "/api/agents/agent-a/files") {
		return filesResponse ?? json({ files, maxSizeBytes: 1024, maxNameLength: 100, allowedExtensions: [".txt"] })
	}
	if (url === "/api/agents/agent-a/mcp-servers") return json({ servers })
	if (url === "/api/embeds?agentId=agent-a") return json({ embeds })
	throw new Error(`unexpected request ${url}`)
}

async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderSummary(canManage = true): Promise<void> {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<AgentCardSummary agentId="agent-a" canManage={canManage} />
			</QueryClientProvider>,
		),
	)
	await settle()
}

beforeEach(() => {
	files = []
	servers = []
	embeds = []
	filesResponse = undefined
	requests = []
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

describe("AgentCardSummary", () => {
	test("shows file and connection counts and counts only enabled embeds for this agent", async () => {
		files = [
			{
				name: "guide.txt",
				sizeBytes: 10,
				createdAt: "2026-10-01T00:00:00Z",
				embeddingStatus: "ready",
				embeddingError: null,
			},
		]
		servers = [
			{
				id: "connection-a",
				name: "Orders",
				transport: "http",
				url: "https://example.com/mcp",
				authMode: "none",
				command: null,
				args: [],
				headers: [],
				env: [],
				tools: [],
				toolCount: 0,
				isWorking: true,
				isDisabled: false,
				revision: 1,
			},
			{
				id: "connection-b",
				name: "Returns",
				transport: "http",
				url: "https://example.com/returns",
				authMode: "none",
				command: null,
				args: [],
				headers: [],
				env: [],
				tools: [],
				toolCount: 0,
				isWorking: false,
				isDisabled: true,
				revision: 1,
			},
		]
		embeds = [false, true].map((isDisabled, index) => ({
			id: `embed-${index}`,
			agentId: "agent-a",
			name: "Shop",
			embedToken: `token-${index}`,
			accessVersion: 1,
			isDisabled,
			appearance: EMBED_FORM_DEFAULTS,
		}))

		await renderSummary()

		expect(host.textContent).toContain(`${t("agents.metricFiles")}: 1`)
		expect(host.textContent).toContain(`${t("agents.metricConnections")}: 2`)
		expect(host.textContent).toContain(`${t("agents.metricEnabledEmbeds")}: 1`)
	})

	test("does not display a loading file count as zero, then shows real empty counts", async () => {
		const pending = Promise.withResolvers<Response>()
		filesResponse = pending.promise
		await renderSummary()

		expect(host.textContent).toContain(`${t("agents.metricFiles")}: …`)
		expect(host.textContent).toContain(`${t("agents.metricConnections")}: 0`)
		expect(host.textContent).toContain(`${t("agents.metricEnabledEmbeds")}: 0`)

		pending.resolve(json({ files: [], maxSizeBytes: 1024, maxNameLength: 100, allowedExtensions: [".txt"] }))
		await settle()
		await settle()
		expect(host.textContent).toContain(`${t("agents.metricFiles")}: 0`)
	})

	test("keeps successful counts visible when one request fails and recovers on refetch", async () => {
		filesResponse = Promise.resolve(new Response("{}", { status: 500 }))
		await renderSummary()

		expect(host.textContent).toContain(`${t("agents.metricFiles")}: ${t("agents.metricUnavailable")}`)
		expect(host.textContent).toContain(`${t("agents.metricConnections")}: 0`)
		expect(host.textContent).toContain(t("agents.summaryLoadFailed"))

		filesResponse = undefined
		await act(async () => queryClient.refetchQueries())
		await settle()
		expect(host.textContent).toContain(`${t("agents.metricFiles")}: 0`)
		expect(host.textContent).not.toContain(t("agents.summaryLoadFailed"))
	})

	test("does not request or show restricted file details for read-only operators", async () => {
		await renderSummary(false)

		expect(requests).not.toContain("/api/agents/agent-a/files")
		expect(host.textContent).not.toContain(t("agents.metricFiles"))
		expect(host.textContent).toContain(`${t("agents.metricConnections")}: 0`)
		expect(host.textContent).toContain(`${t("agents.metricEnabledEmbeds")}: 0`)
	})
})
