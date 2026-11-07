import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConnectionDialog } = await import("./connection-dialog")
const { getListMcpServersQueryKey } = await import("@/api/generated/mcp/mcp.ts")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const SERVERS_QUERY_KEY = getListMcpServersQueryKey("agent")

const SERVER: McpServer = {
	id: "srv",
	name: "Stock",
	transport: "http",
	url: "https://example.test/mcp",
	authMode: "headers",
	command: null,
	args: [],
	headers: [{ name: "X-API-Key", hasValue: true }],
	env: [],
	tools: [],
	toolCount: 0,
	isWorking: true,
	isDisabled: false,
	revision: 4,
}

type RecordedRequest = { url: string; method: string; body: unknown }

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let requests: RecordedRequest[]
let responses: Array<Response | Error>

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

function problem(code: string, status: number): Response {
	return json({ type: "about:blank", code }, status)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function element<T extends HTMLElement>(selector: string): T {
	const found = document.querySelector<T>(selector)
	if (!found) throw new Error(`${selector} not rendered`)
	return found
}

function button(label: string): HTMLButtonElement {
	const found = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === label)
	if (!found) throw new Error(`button ${label} not rendered`)
	return found
}

async function click(target: HTMLElement) {
	await act(async () => target.click())
	await settle()
}

async function type(input: HTMLInputElement, text: string) {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(input, text)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function chooseHeaders() {
	await click(element("#mcp-auth"))
	const headers = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
		(option) => option.textContent === t("mcp.authHeaders"),
	)
	if (!headers) throw new Error("headers option not rendered")
	await click(headers)
}

async function renderDialog(server?: McpServer) {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<ConnectionDialog agentId="agent" server={server} stdioAllowed={false} />
			</QueryClientProvider>,
		),
	)
	await settle()
}

beforeEach(() => {
	requests = []
	responses = []
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const method = init?.method ?? "GET"
		requests.push({ url, method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined })
		const response = responses.shift()
		if (!response) throw new Error(`unexpected request ${method} ${url}`)
		if (response instanceof Error) throw response
		return response
	}) as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
	queryClient.setQueryData(SERVERS_QUERY_KEY, {
		data: { servers: [], stdioAllowed: false },
		status: 200,
		headers: new Headers(),
	})
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

describe("ConnectionDialog", () => {
	test("starts from an empty draft every time it opens", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		await type(element<HTMLInputElement>("#mcp-name"), "Stock")

		await click(button(t("common.cancel")))
		await click(button(t("mcp.add")))

		expect(element<HTMLInputElement>("#mcp-name").value).toBe("")
		expect(document.querySelector("#mcp-name-error") === null).toBe(true)
	})

	test("drops cancelled edits and entered secrets when reopened for editing", async () => {
		await renderDialog(SERVER)
		const edit = `[aria-label="${t("mcp.edit")}"]`
		await click(element(edit))

		const url = element<HTMLInputElement>("#mcp-url")
		const secret = element<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`)
		await type(url, "https://edited.test/mcp")
		await type(secret, "secret")

		await click(button(t("common.cancel")))
		await click(element(edit))

		expect(element<HTMLInputElement>("#mcp-url").value).toBe("https://example.test/mcp")
		expect(element<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`).value).toBe("")
	})

	test("blocks a disallowed stdio save until the operator switches to HTTP", async () => {
		await renderDialog({ ...SERVER, transport: "stdio", url: null, authMode: null, command: "bunx", headers: [] })
		await click(element(`[aria-label="${t("mcp.edit")}"]`))
		const save = element<HTMLButtonElement>('form button[type="submit"]')

		expect(save.disabled).toBe(true)
		await click(save)
		expect(requests).toEqual([])

		await click(element("#mcp-transport"))
		const http = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
			(option) => option.textContent === t("mcp.transportHttp"),
		)
		if (!http) throw new Error("HTTP option not rendered")
		await click(http)

		expect(save.disabled).toBe(false)
	})

	test("associates the first invalid field with its error and focuses it", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		await click(element('form button[type="submit"]'))

		const name = element<HTMLInputElement>("#mcp-name")
		const error = element<HTMLElement>("#mcp-name-error")

		expect(error.textContent).toBe(t("mcp.errorName"))
		expect(error.getAttribute("role")).toBe("alert")
		expect(name.getAttribute("aria-invalid")).toBe("true")
		expect(name.getAttribute("aria-describedby")).toBe("mcp-name-error")
		expect(document.activeElement === name).toBe(true)
	})

	test("focuses the empty secret value instead of its filled name", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		await chooseHeaders()
		await click(button(t("mcp.addHeader")))

		await type(element<HTMLInputElement>("#mcp-name"), "Stock")
		await type(element<HTMLInputElement>("#mcp-url"), "https://example.test/mcp")
		await type(element<HTMLInputElement>(`[aria-label="${t("mcp.headerName")}"]`), "X-API-Key")
		await click(element('form button[type="submit"]'))

		const value = element<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`)
		expect(document.activeElement?.id).toBe(value.id)
		expect(value.getAttribute("aria-invalid")).toBe("true")
	})

	test("marks the name and connection details as required", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))

		expect(element<HTMLInputElement>("#mcp-name").required).toBe(true)
		expect(element<HTMLInputElement>("#mcp-url").required).toBe(true)
		expect(document.body.textContent).toContain(t("common.requiredHint"))
	})

	test("retries runtime and HTTP failures without losing its draft or secret", async () => {
		responses = [new TypeError("Failed to fetch"), problem("internal-error", 500), json({ server: SERVER }, 201)]
		await renderDialog()
		await click(button(t("mcp.add")))
		await chooseHeaders()
		await click(button(t("mcp.addHeader")))
		await type(element<HTMLInputElement>("#mcp-name"), "Inventory")
		await type(element<HTMLInputElement>("#mcp-url"), "https://inventory.test/mcp")
		await type(element<HTMLInputElement>(`[aria-label="${t("mcp.headerName")}"]`), "X-API-Key")
		await type(element<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`), "secret")

		await click(element('form button[type="submit"]'))

		expect(element<HTMLElement>('[role="dialog"] [role="alert"]').textContent).toBe(t("mcp.errorSave"))
		expect(element<HTMLInputElement>("#mcp-name").value).toBe("Inventory")
		expect(element<HTMLInputElement>("#mcp-url").value).toBe("https://inventory.test/mcp")
		expect(element<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`).value).toBe("secret")
		expect(queryClient.getQueryState(SERVERS_QUERY_KEY)?.isInvalidated).toBe(false)

		await click(element('form button[type="submit"]'))
		expect(element<HTMLElement>('[role="dialog"] [role="alert"]').textContent).toBe(t("mcp.errorSave"))

		await click(element('form button[type="submit"]'))

		expect(document.querySelector('[role="dialog"]') === null).toBe(true)
		expect(queryClient.getQueryState(SERVERS_QUERY_KEY)?.isInvalidated).toBe(true)
		const request: RecordedRequest = {
			url: "/api/agents/agent/mcp-servers",
			method: "POST",
			body: {
				name: "Inventory",
				server: {
					transport: "http",
					url: "https://inventory.test/mcp",
					authMode: "headers",
					headers: { "X-API-Key": "secret" },
				},
			},
		}
		expect(requests).toEqual([request, request, request])
	})

	test("retries a conflicting edit without losing secrets or bumping the revision", async () => {
		responses = [problem("configuration-conflict", 409), json({ server: { ...SERVER, revision: 5 } })]
		await renderDialog(SERVER)
		await click(element(`[aria-label="${t("mcp.edit")}"]`))
		await type(element<HTMLInputElement>("#mcp-name"), "Inventory")
		await type(element<HTMLInputElement>("#mcp-url"), "https://edited.test/mcp")
		await type(element<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`), "rotated-secret")

		await click(element('form button[type="submit"]'))

		expect(element<HTMLElement>('[role="dialog"] [role="alert"]').textContent).toBe(t("mcp.errorConflict"))
		expect(element<HTMLInputElement>("#mcp-name").value).toBe("Inventory")
		expect(element<HTMLInputElement>("#mcp-url").value).toBe("https://edited.test/mcp")
		expect(element<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`).value).toBe("rotated-secret")
		expect(queryClient.getQueryState(SERVERS_QUERY_KEY)?.isInvalidated).toBe(false)

		await click(element('form button[type="submit"]'))

		expect(document.querySelector('[role="dialog"]') === null).toBe(true)
		expect(queryClient.getQueryState(SERVERS_QUERY_KEY)?.isInvalidated).toBe(true)
		const request: RecordedRequest = {
			url: "/api/agents/agent/mcp-servers/srv",
			method: "PUT",
			body: {
				name: "Inventory",
				expectedRevision: 4,
				server: {
					transport: "http",
					url: "https://edited.test/mcp",
					authMode: "headers",
					headers: { "X-API-Key": "rotated-secret" },
				},
			},
		}
		expect(requests).toEqual([request, request])
	})
})
