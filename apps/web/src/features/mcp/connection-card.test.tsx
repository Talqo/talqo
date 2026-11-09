import type { ListMcpServersQueryResult } from "@/api/generated/mcp/mcp.ts"
import type { McpServer } from "@/api/generated/models/mcpServer.zod"

import { json, type RecordedRequest, recordRequest } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

const { ConnectionCard } = await import("./connection-card")
const { getListMcpServersQueryKey } = await import("@/api/generated/mcp/mcp.ts")
const { t } = await import("i18next")

const SERVERS_QUERY_KEY = getListMcpServersQueryKey("agent")

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

function renderCard(value: McpServer, canManage = false) {
	return act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<ConnectionCard agentId="agent" canManage={canManage} server={value} stdioAllowed={false} />
			</QueryClientProvider>,
		),
	)
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

function queryButton(label: string): HTMLButtonElement | undefined {
	return [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label)
}

function removeButton(): HTMLButtonElement {
	const found = host.querySelector<HTMLButtonElement>(`button[aria-label="${t("mcp.remove")}"]`)
	if (!found) throw new Error("remove button not rendered")
	return found
}

function switchControl(name: string): HTMLElement {
	const found = card().querySelector<HTMLElement>(`[role="switch"][aria-label="${name}"]`)
	if (!found) throw new Error(`switch ${name} not rendered`)
	return found
}

function switchInput(name: string): HTMLInputElement {
	const control = switchControl(name)
	// Happy DOM toggles twice when the labelled switch span is clicked; use its real checkbox.
	const found = control.parentElement?.querySelector<HTMLInputElement>('input[type="checkbox"]')
	if (!found) throw new Error(`switch input ${name} not rendered`)
	return found
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
		const http = server({ id: "remote", name: "Remote", isDisabled: true })
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
		expect(card().textContent).toContain(t("mcp.stdioDisabled"))

		await renderCard(http, true)
		const httpToggle = switchInput(t("mcp.enabledFor", { name: http.name }))
		expect(httpToggle.disabled).toBe(false)
		expect(httpToggle.checked).toBe(false)
		await click(httpToggle)
		expect(requests).toEqual(["/api/agents/agent/mcp-servers/remote/enable"])
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

	test("toggles a disabled tool on and sends every stored tool state", async () => {
		const stock = server({
			tools: [
				{ name: "price", description: "Current price", enabled: false },
				{ name: "history", description: "Price history", enabled: true },
			],
			toolCount: 2,
		})
		const previous: ListMcpServersQueryResult = {
			data: { servers: [stock], stdioAllowed: false },
			status: 200,
			headers: new Headers(),
		}
		const bodies: unknown[] = []
		spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PUT") {
				if (typeof init.body !== "string") throw new Error("missing update body")
				bodies.push(JSON.parse(init.body))
				return json({ server: stock })
			}
			throw new Error("unexpected request")
		}) as typeof fetch)
		client.setQueryData(SERVERS_QUERY_KEY, previous)
		await renderCard(stock, true)
		await click(button(t("mcp.showTools")))

		await click(switchInput("price"))

		expect(bodies).toEqual([
			{
				name: "Stock",
				expectedRevision: 1,
				tools: [
					{ enabled: true, name: "price" },
					{ enabled: true, name: "history" },
				],
				server: { transport: "http", url: "https://example.test/mcp", authMode: "none" },
			},
		])
		const cached = client.getQueryData<ListMcpServersQueryResult>(SERVERS_QUERY_KEY)
		expect(cached?.data.servers[0]?.tools.map(({ enabled }) => enabled)).toEqual([true, true])
		expect(client.getQueryState(SERVERS_QUERY_KEY)?.isInvalidated).toBe(true)
	})

	test("hides management controls from readers and disables tool toggles", async () => {
		await renderCard(
			server({
				isWorking: false,
				tools: [{ name: "price", description: "", enabled: true }],
				toolCount: 1,
			}),
			false,
		)

		expect(host.querySelector("[role='alert']")?.textContent).toBe(t("mcp.unreachable"))
		await click(button(t("mcp.showTools")))
		expect(switchControl("price").getAttribute("aria-disabled")).toBe("true")
		expect(host.querySelector(`[role="switch"][aria-label="${t("mcp.enabledFor", { name: "Stock" })}"]`) === null).toBe(
			true,
		)
		expect(host.querySelector(`button[aria-label="${t("mcp.remove")}"]`) === null).toBe(true)
		expect(queryButton(t("mcp.hideTools")) !== undefined).toBe(true)
	})

	test("prefers the stdio deployment notice over an unreachable alert and disables its tools", async () => {
		await renderCard(
			server({
				id: "local",
				name: "Local",
				transport: "stdio",
				url: null,
				authMode: null,
				command: "bunx",
				isWorking: false,
				tools: [{ name: "price", description: "", enabled: true }],
				toolCount: 1,
			}),
			true,
		)

		expect(card().textContent).toContain(t("mcp.stdioDisabled"))
		expect(host.querySelector("[role='alert']") === null).toBe(true)
		await click(button(t("mcp.showTools")))
		expect(card().querySelector("fieldset")?.disabled).toBe(true)
	})

	test("offers no tool disclosure when the connection exposes no tools", async () => {
		await renderCard(server({ tools: [], toolCount: 0 }))

		expect(queryButton(t("mcp.showTools")) === undefined).toBe(true)
	})

	test("reports a connection deleted elsewhere when a tool toggle fails with 404", async () => {
		spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL) =>
			json(
				{ code: "mcp-server-not-found", type: "https://docs.talqo.chat/problems#mcp-server-not-found" },
				404,
			)) as typeof fetch)
		await renderCard(
			server({
				tools: [{ name: "price", description: "", enabled: true }],
				toolCount: 1,
			}),
			true,
		)
		await click(button(t("mcp.showTools")))

		await click(switchInput("price"))

		expect(host.querySelector("[role='alert']")?.textContent).toBe(t("mcp.notFound"))
	})

	test("removes a connection after confirmation and refreshes the list", async () => {
		const requests: RecordedRequest[] = []
		spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
			recordRequest(requests, input, init)
			return new Response(null, { status: 204 })
		}) as typeof fetch)
		client.setQueryData(SERVERS_QUERY_KEY, {
			data: { servers: [server()], stdioAllowed: false },
			status: 200,
			headers: new Headers(),
		})
		await renderCard(server(), true)

		await click(removeButton())
		const dialog = document.querySelector<HTMLElement>("[role='alertdialog']")
		if (!dialog) throw new Error("confirmation not rendered")
		expect(dialog.textContent).toContain(t("mcp.removePrompt", { name: "Stock" }))
		const confirm = [...dialog.querySelectorAll("button")].find(
			(candidate) => candidate.textContent === t("mcp.removeConfirm"),
		)
		if (!confirm) throw new Error("confirm button not rendered")
		await click(confirm)

		expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
			{ method: "DELETE", url: "/api/agents/agent/mcp-servers/stock" },
		])
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		expect(client.getQueryState(SERVERS_QUERY_KEY)?.isInvalidated).toBe(true)
	})

	test("shows a removal failure inside the confirmation and clears it on cancel", async () => {
		spyOn(globalThis, "fetch").mockImplementation((async (_input: RequestInfo | URL) =>
			json(
				{ code: "internal-server-error", type: "https://docs.talqo.chat/problems#internal-server-error" },
				500,
			)) as typeof fetch)
		await renderCard(server(), true)

		await click(removeButton())
		const dialog = document.querySelector<HTMLElement>("[role='alertdialog']")
		if (!dialog) throw new Error("confirmation not rendered")
		const confirm = [...dialog.querySelectorAll("button")].find(
			(candidate) => candidate.textContent === t("mcp.removeConfirm"),
		)
		if (!confirm) throw new Error("confirm button not rendered")
		await click(confirm)

		expect(document.querySelector("[role='alertdialog'] [role='alert']")?.textContent).toBe(
			t("problems.internal-server-error"),
		)
		const cancel = [...dialog.querySelectorAll("button")].find(
			(candidate) => candidate.textContent === t("common.cancel"),
		)
		if (!cancel) throw new Error("cancel button not rendered")
		await click(cancel)
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)

		await click(removeButton())
		expect(document.querySelector("[role='alertdialog'] [role='alert']") === null).toBe(true)
	})
})
