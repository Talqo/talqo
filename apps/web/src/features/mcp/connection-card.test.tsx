import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConnectionCard } = await import("./connection-card")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let client: InstanceType<typeof QueryClient>

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
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	client.clear()
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
	})
})
