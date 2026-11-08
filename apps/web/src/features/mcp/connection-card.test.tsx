import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import { act, createTestHarness, QueryClientProvider, type Root } from "@/test-helpers"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { ConnectionCard } = await import("./connection-card")
const { t } = await import("i18next")

let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let client: ReturnType<typeof createTestHarness>["queryClient"]

function server(overrides: Partial<McpServer> = {}): McpServer {
	return {
		id: "stock",
		name: "Stock",
		transport: "http",
		url: "https://example.test/mcp",
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
		...overrides,
	}
}

function renderCard(value: McpServer) {
	return act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<ConnectionCard agentId="agent" canManage={false} server={value} stdioAllowed={false} />
			</QueryClientProvider>,
		),
	)
}

function card(): HTMLElement {
	const found = host.querySelector<HTMLElement>("[data-testid='mcp-server-card']")
	if (!found) throw new Error("connection card not rendered")
	return found
}

beforeEach(() => {
	harness = createTestHarness()
	;({ host, root, queryClient: client } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("ConnectionCard", () => {
	test("shows the connection status as text beside the status dot", async () => {
		await renderCard(server({ isWorking: true }))
		const metadata = card().querySelector("[data-slot='card-description']")
		expect(metadata?.textContent).toContain(t("mcp.statusConnected"))
		expect(metadata?.querySelector("[aria-hidden='true']")).not.toBeNull()

		await renderCard(server({ isWorking: false }))
		expect(card().querySelector("[data-slot='card-description']")?.textContent).toContain(t("mcp.statusUnreachable"))
	})

	test("truncates a long connection name in the heading while keeping the full name available", async () => {
		const fullName = `stock-${"inventory-".repeat(12)}`
		await renderCard(server({ name: fullName }))

		const heading = card().querySelector("[data-slot='card-title']")
		const label = heading?.querySelector("span")
		expect(heading?.textContent).toBe(fullName)
		expect(label?.getAttribute("title")).toBe(fullName)
		expect(label?.className).toContain("truncate")
	})
})
