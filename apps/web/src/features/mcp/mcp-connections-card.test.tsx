import type { QueryClient } from "@/test-helpers"

import { act, createTestHarness, json, QueryClientProvider, type Root } from "@/test-helpers"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { McpConnectionsCard } = await import("./mcp-connections-card")
const { LanguageProvider } = await import("@/lib/use-language")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>

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
})
