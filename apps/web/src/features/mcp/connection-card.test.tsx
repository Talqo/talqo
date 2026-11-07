import type { ListMcpServersQueryResult } from "@/api/generated/mcp/mcp.ts"
import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConnectionCard } = await import("./connection-card")
const { getListMcpServersQueryKey } = await import("@/api/generated/mcp/mcp.ts")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const SERVERS_QUERY_KEY = getListMcpServersQueryKey("agent")

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

function renderCard(value: McpServer, canManage = false) {
	return act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<ConnectionCard agentId="agent" canManage={canManage} server={value} stdioAllowed={false} />
			</QueryClientProvider>,
		),
	)
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function click(target: HTMLElement) {
	await act(async () => target.click())
	await settle()
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

function switchInput(name: string): HTMLInputElement {
	const control = card().querySelector<HTMLElement>(`[role="switch"][aria-label="${name}"]`)
	// Happy DOM toggles twice when the labelled switch span is clicked; use its real checkbox.
	const found = control?.parentElement?.querySelector<HTMLInputElement>('input[type="checkbox"]')
	if (!found) throw new Error(`switch input ${name} not rendered`)
	return found
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
	mock.restore()
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

	test("disables a disallowed stdio toggle without disabling HTTP connections", async () => {
		const stdio = server({
			id: "local",
			name: "Local",
			transport: "stdio",
			url: null,
			authMode: null,
			command: "bunx",
		})
		const http = server({ id: "remote", name: "Remote" })
		const requests: string[] = []
		spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
			requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
			return json({ server: http })
		}) as typeof fetch)

		await renderCard(stdio, true)
		const stdioToggle = switchInput(t("mcp.enabledFor", { name: stdio.name }))
		expect(stdioToggle.disabled).toBe(true)
		await click(stdioToggle)
		expect(requests).toEqual([])

		await renderCard(http, true)
		const httpToggle = switchInput(t("mcp.enabledFor", { name: http.name }))
		expect(httpToggle.disabled).toBe(false)
		await click(httpToggle)
		expect(requests).toEqual(["/api/agents/agent/mcp-servers/remote/disable"])
	})

	test("updates only the target server's toggled tool optimistically and restores the whole cache after rejection", async () => {
		const stock = server({
			tools: [
				{ name: "price", description: "Current price", enabled: true },
				{ name: "history", description: "Price history", enabled: true },
			],
			toolCount: 2,
		})
		const warehouse = server({
			id: "warehouse",
			name: "Warehouse",
			tools: [{ name: "price", description: "Warehouse price", enabled: true }],
			toolCount: 1,
		})
		const previous: ListMcpServersQueryResult = {
			data: { servers: [stock, warehouse], stdioAllowed: false },
			status: 200,
			headers: new Headers(),
		}
		const originalData = structuredClone(previous.data)
		const restoredCache = { ...previous, data: originalData }
		const [originalStock, originalWarehouse] = originalData.servers
		if (!originalStock || !originalWarehouse) throw new Error("server fixture incomplete")
		const update = Promise.withResolvers<Response>()
		spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PUT") return update.promise
			throw new Error("unexpected request")
		}) as typeof fetch)
		client.setQueryData(SERVERS_QUERY_KEY, previous)
		await renderCard(stock, true)
		await click(button(t("mcp.showTools")))

		await click(switchInput("price"))

		expect(client.getQueryData(SERVERS_QUERY_KEY)).toEqual({
			...restoredCache,
			data: {
				...originalData,
				servers: [
					{
						...originalStock,
						tools: [
							{ name: "price", description: "Current price", enabled: false },
							{ name: "history", description: "Price history", enabled: true },
						],
					},
					originalWarehouse,
				],
			},
		})

		await act(async () => update.resolve(json({ code: "server-error" }, 500)))
		await settle()

		expect(host.querySelector("[role='alert']")?.textContent).toBe(t("mcp.actionFailed"))
		expect(client.getQueryState(SERVERS_QUERY_KEY)?.isInvalidated).toBe(true)
		expect(client.getQueryData(SERVERS_QUERY_KEY)).toEqual(restoredCache)
	})
})
