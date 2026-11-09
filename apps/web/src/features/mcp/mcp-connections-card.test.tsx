import type { QueryClient } from "@/testing/component-harness"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root } from "@/testing/component-harness"
import { click, findButton as button } from "@/testing/dom"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { McpConnectionsCard } = await import("./mcp-connections-card")
const { LanguageProvider } = await import("@/lib/use-language")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>
let body: unknown
let failure: Response | undefined
let responsePromise: Promise<Response> | undefined
let requests: number

async function respond(input: RequestInfo | URL): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	if (url !== "/api/agents/agent-1/mcp-servers") throw new Error(`unexpected request ${url}`)
	requests += 1
	if (responsePromise) return responsePromise
	if (failure) return failure
	return json(body)
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

function server(overrides: Record<string, unknown> = {}) {
	return {
		id: "local",
		name: "Local",
		transport: "stdio",
		url: null,
		authMode: null,
		command: "bunx",
		args: [],
		headers: [],
		env: [],
		tools: [],
		toolCount: 0,
		isWorking: true,
		isDisabled: false,
		revision: 1,
		...overrides,
	}
}

beforeEach(() => {
	body = { servers: [], stdioAllowed: false }
	failure = undefined
	responsePromise = undefined
	requests = 0
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
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

	test("keeps adding disabled until the connection list determines allowed transports", async () => {
		const response = Promise.withResolvers<Response>()
		responsePromise = response.promise
		await renderCard(true)

		expect(host.textContent).toContain(t("mcp.loading"))
		expect(addButtons()).toHaveLength(1)
		expect(addButtons()[0]?.disabled).toBe(true)

		await act(async () => response.resolve(json({ servers: [], stdioAllowed: false })))
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(host.textContent).not.toContain(t("mcp.loading"))
		expect(addButtons()).toHaveLength(2)
		expect(addButtons().every((element) => !element.disabled)).toBe(true)
	})

	test("shows the list failure and retries the request", async () => {
		failure = new Response(JSON.stringify({ code: "internal-server-error" }), {
			status: 500,
			headers: { "content-type": "application/json" },
		})
		await renderCard(true)

		expect(host.querySelector("[role='alert']")?.textContent).toContain(t("mcp.loadFailed"))
		expect(requests).toBe(1)
		failure = undefined
		await click(button(t("common.retry")))
		expect(requests).toBe(2)
		expect(host.textContent).toContain(t("mcp.emptyTitle"))
	})

	test("renders the loaded connections with the deployment's transport permissions", async () => {
		body = { servers: [server()], stdioAllowed: true }
		await renderCard(false)

		const card = host.querySelector<HTMLElement>("[data-testid='mcp-server-card']")
		if (!card) throw new Error("connection card not rendered")
		expect(card.textContent).toContain("Local")
		expect(card.textContent).not.toContain(t("mcp.stdioDisabled"))
		expect(host.querySelector(`button[aria-label="${t("mcp.edit")}"]`) === null).toBe(true)

		body = { servers: [server()], stdioAllowed: false }
		await act(async () => queryClient.refetchQueries())
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0))
		})
		expect(host.querySelector("[data-testid='mcp-server-card']")?.textContent).toContain(t("mcp.stdioDisabled"))
	})
})
