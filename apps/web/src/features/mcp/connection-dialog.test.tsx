import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConnectionDialog } = await import("./connection-dialog")
const { getListMcpServersQueryKey } = await import("@/api/generated/mcp/mcp.ts")
const { MCP_SERVER_NAME_LIMIT } = await import("./connection-body")
const { MCP_ENV_VARIABLE_LIMIT } = await import("@/features/mcp/mcp-env-variables")
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
let responses: Array<Response | Error | Promise<Response>>

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

function dialogButton(label: string, position: "first" | "last" = "first"): HTMLButtonElement {
	const dialog = element<HTMLElement>('[role="dialog"]')
	const found = [...dialog.querySelectorAll("button")].filter(
		(candidate) => candidate.textContent === label || candidate.getAttribute("aria-label") === label,
	)
	const selected = position === "last" ? found.at(-1) : found[0]
	if (!selected) throw new Error(`dialog button ${label} not rendered`)
	return selected
}

async function click(target: HTMLElement) {
	await act(async () => target.click())
	await settle()
}

async function focus(target: HTMLElement) {
	await act(async () => target.focus())
}

async function type(input: HTMLInputElement, text: string) {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(input, text)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function chooseOption(trigger: HTMLElement, label: string) {
	await click(trigger)
	const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
		(candidate) => candidate.textContent === label,
	)
	if (!option) throw new Error(`${label} option not rendered`)
	await click(option)
	return option
}

async function chooseHeaders() {
	await chooseOption(element("#mcp-auth"), t("mcp.authHeaders"))
}

async function renderDialog(server?: McpServer, options: { disabled?: boolean; stdioAllowed?: boolean } = {}) {
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<ConnectionDialog
					agentId="agent"
					server={server}
					stdioAllowed={options.stdioAllowed ?? false}
					disabled={options.disabled}
				/>
			</QueryClientProvider>,
		),
	)
	await settle()
}

function submit(): Promise<void> {
	return click(element('form button[type="submit"]'))
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
		const resolved = await response
		if (resolved instanceof Error) throw resolved
		return resolved
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
		expect(document.body.textContent).toContain(t("mcp.stdioDisabled"))
		expect(element<HTMLInputElement>("#mcp-command").closest("fieldset")?.disabled).toBe(true)
		await click(save)
		expect(requests).toEqual([])

		const stdio = await chooseOption(element("#mcp-transport"), t("mcp.transportStdio"))
		expect(stdio.getAttribute("aria-disabled")).toBe("true")
		await chooseOption(element("#mcp-transport"), t("mcp.transportHttp"))

		expect(save.disabled).toBe(false)
		expect(document.querySelector("#mcp-command") === null).toBe(true)
	})

	test("associates the first invalid field with its error and focuses it", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		await focus(element("#mcp-url"))
		const form = element<HTMLFormElement>("form")
		const submitted = new Event("submit", { bubbles: true, cancelable: true })
		await act(async () => form.dispatchEvent(submitted))
		await settle()
		expect(submitted.defaultPrevented).toBe(true)

		const name = element<HTMLInputElement>("#mcp-name")
		const error = element<HTMLElement>("#mcp-name-error")

		expect(error.textContent).toBe(t("mcp.errorName"))
		expect(error.getAttribute("role")).toBe("alert")
		expect(name.getAttribute("aria-invalid")).toBe("true")
		expect(name.getAttribute("aria-describedby")).toBe("mcp-name-error")
		expect(element("#mcp-url").getAttribute("aria-describedby") === null).toBe(true)
		expect(document.activeElement === name).toBe(true)

		await click(button(t("common.cancel")))
		await click(button(t("mcp.add")))
		expect(document.querySelector("#mcp-name-error") === null).toBe(true)
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
		expect(value.getAttribute("aria-describedby")).toBe("mcp-headers-error")
		expect(element<HTMLElement>("#mcp-headers-error").textContent).toBe(t("mcp.errorSecret"))
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
		expect(element<HTMLButtonElement>('form button[type="submit"]').textContent).toBe(t("mcp.save"))
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

	test("rejects names outside ASCII and beyond the API limit", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		const name = element<HTMLInputElement>("#mcp-name")
		expect(name.getAttribute("aria-invalid")).not.toBe("true")
		expect(name.getAttribute("aria-describedby") === null).toBe(true)
		expect(element("#mcp-url").getAttribute("aria-invalid")).not.toBe("true")

		await type(name, "Obchodník")
		await focus(element("#mcp-url"))
		await submit()

		expect(element<HTMLElement>("#mcp-name-error").textContent).toBe(t("mcp.errorNameAscii"))
		expect(name.getAttribute("aria-invalid")).toBe("true")
		expect(document.activeElement === name).toBe(true)

		await type(name, "a".repeat(MCP_SERVER_NAME_LIMIT + 1))
		await focus(element("#mcp-url"))
		await submit()

		expect(element<HTMLElement>("#mcp-name-error").textContent).toBe(
			t("mcp.errorNameLength", { limit: MCP_SERVER_NAME_LIMIT }),
		)
		expect(document.activeElement === name).toBe(true)
		expect(requests).toEqual([])
	})

	test("requires an address before saving an HTTP connection", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		expect(element<HTMLButtonElement>('form button[type="submit"]').textContent).toBe(t("mcp.add"))
		expect(document.querySelector(`[aria-label="${t("mcp.headerName")}"]`) === null).toBe(true)
		expect(document.body.textContent).not.toContain(t("mcp.headersCount", { used: 0, limit: MCP_ENV_VARIABLE_LIMIT }))
		await type(element<HTMLInputElement>("#mcp-name"), "Stock")
		await submit()

		const url = element<HTMLInputElement>("#mcp-url")
		expect(element<HTMLElement>("#mcp-url-error").textContent).toBe(t("mcp.errorAddress"))
		expect(url.getAttribute("aria-invalid")).toBe("true")
		expect(url.getAttribute("aria-describedby")).toBe("mcp-url-error")
		expect(document.activeElement === url).toBe(true)

		await chooseHeaders()
		expect(document.querySelector("#mcp-url-error") === null).toBe(true)
		expect(requests).toEqual([])
	})

	test("requires a command and complete environment values for stdio", async () => {
		await renderDialog(undefined, { stdioAllowed: true })
		await click(button(t("mcp.add")))
		await submit()
		expect(document.querySelector("#mcp-name-error") !== null).toBe(true)

		await chooseOption(element("#mcp-transport"), t("mcp.transportStdio"))
		expect(document.querySelector("#mcp-name-error") === null).toBe(true)
		await type(element<HTMLInputElement>("#mcp-name"), "Local")
		const command = element<HTMLInputElement>("#mcp-command")
		expect(command.getAttribute("aria-invalid")).not.toBe("true")
		expect(command.getAttribute("aria-describedby") === null).toBe(true)
		await submit()

		expect(element<HTMLElement>("#mcp-command-error").textContent).toBe(t("mcp.errorCommand"))
		expect(command.getAttribute("aria-invalid")).toBe("true")
		expect(command.getAttribute("aria-describedby")).toBe("mcp-command-error")
		expect(document.activeElement === command).toBe(true)

		await type(command, "bunx")
		await click(dialogButton(t("mcp.addEnv"), "last"))
		await type(element<HTMLInputElement>(`[aria-label="${t("mcp.envName")}"]`), "API_KEY")
		await submit()

		const value = element<HTMLInputElement>(`[aria-label="${t("mcp.envValue")}"]`)
		expect(element<HTMLElement>("#mcp-env-error").textContent).toBe(t("mcp.errorSecret"))
		expect(value.getAttribute("aria-invalid")).toBe("true")
		expect(value.getAttribute("aria-describedby")).toBe("mcp-env-error")
		expect(document.activeElement === value).toBe(true)
		expect(requests).toEqual([])
	})

	test("hides stdio from new connections when the deployment disallows it", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))

		await click(element("#mcp-transport"))

		const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent)
		expect(options).toEqual([t("mcp.transportHttp")])
	})

	test("maps each server failure code to an operator-facing message", async () => {
		responses = [
			problem("invalid-request", 400),
			problem("malformed-json", 400),
			problem("invalid-mcp-server-name", 400),
			problem("duplicate-mcp-server-name", 409),
			problem("mcp-stdio-disabled", 409),
		]
		await renderDialog()
		await click(button(t("mcp.add")))
		await type(element<HTMLInputElement>("#mcp-name"), "Stock")
		await type(element<HTMLInputElement>("#mcp-url"), "https://example.test/mcp")

		for (const message of [
			t("mcp.errorAddress"),
			t("mcp.errorAddress"),
			t("mcp.errorNameLength", { limit: MCP_SERVER_NAME_LIMIT }),
			t("mcp.errorDuplicateName"),
			t("mcp.stdioDisabled"),
		]) {
			// Responses are consumed in order, so each submit must finish before the next.
			// eslint-disable-next-line no-await-in-loop
			await submit()
			expect(document.querySelector<HTMLElement>('[role="dialog"] [role="alert"]')?.textContent).toBe(message)
		}
		expect(requests).toHaveLength(5)
	})

	test("restores a stdio connection's arguments and stored environment names for editing", async () => {
		const stdio = {
			...SERVER,
			transport: "stdio" as const,
			url: null,
			authMode: null,
			command: "bunx",
			headers: [],
			args: ["-y", "server"],
			env: [{ name: "API_KEY", hasValue: true }],
		}
		responses = [json({ server: stdio })]
		await renderDialog(stdio, { stdioAllowed: true })
		await click(element(`[aria-label="${t("mcp.edit")}"]`))

		expect(element<HTMLInputElement>("#mcp-command").value).toBe("bunx")
		expect(
			[...document.querySelectorAll<HTMLInputElement>(`[aria-label="${t("mcp.arguments")}"]`)].map(
				(input) => input.value,
			),
		).toEqual(["-y", "server"])
		expect(element<HTMLInputElement>(`[aria-label="${t("mcp.envName")}"]`).value).toBe("API_KEY")
		expect(element<HTMLInputElement>(`[aria-label="${t("mcp.envValue")}"]`).value).toBe("")

		const args = [...document.querySelectorAll<HTMLInputElement>(`[aria-label="${t("mcp.arguments")}"]`)]
		const firstArg = args[0]
		if (!firstArg) throw new Error("argument row not rendered")
		await type(firstArg, "-q")
		await submit()

		expect(requests).toEqual([
			{
				url: "/api/agents/agent/mcp-servers/srv",
				method: "PUT",
				body: {
					name: "Stock",
					expectedRevision: 4,
					server: { transport: "stdio", command: "bunx", args: ["-q", "server"] },
				},
			},
		])
	})

	test("disables the add trigger when the operator cannot manage connections", async () => {
		await renderDialog(undefined, { disabled: true })

		const add = button(t("mcp.add"))
		expect(add.disabled).toBe(true)
		await click(add)
		expect(document.querySelector('[role="dialog"]') === null).toBe(true)
	})

	test("keeps the dialog open and shows progress while a create is pending", async () => {
		const created = Promise.withResolvers<Response>()
		responses = [created.promise]
		queryClient.setQueryData(["unrelated"], { value: 1 })
		await renderDialog()
		await click(button(t("mcp.add")))
		await submit()
		expect(element<HTMLElement>("#mcp-name-error").textContent).toBe(t("mcp.errorName"))

		await type(element<HTMLInputElement>("#mcp-name"), "Stock")
		await type(element<HTMLInputElement>("#mcp-url"), "https://example.test/mcp")

		await submit()

		expect(document.querySelector("#mcp-name-error") === null).toBe(true)
		const save = button(t("mcp.saving"))
		expect(save.disabled).toBe(true)
		const cancel = button(t("common.cancel"))
		expect(cancel.disabled).toBe(true)
		await click(cancel)
		await act(async () =>
			element<HTMLElement>('[role="dialog"]').dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
			),
		)
		await settle()
		expect(document.querySelector('[role="dialog"]') !== null).toBe(true)

		await act(async () => created.resolve(json({ server: SERVER }, 201)))
		await settle()

		expect(document.querySelector('[role="dialog"]') === null).toBe(true)
		expect(queryClient.getQueryState(SERVERS_QUERY_KEY)?.isInvalidated).toBe(true)
		expect(queryClient.getQueryState(["unrelated"])?.isInvalidated).toBe(false)
	})

	test("focuses a whitespace-only header name that carries an orphan value", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		await chooseHeaders()
		await click(dialogButton(t("mcp.addHeader")))
		await type(element<HTMLInputElement>("#mcp-name"), "Stock")
		await type(element<HTMLInputElement>("#mcp-url"), "https://example.test/mcp")
		const name = element<HTMLInputElement>(`[aria-label="${t("mcp.headerName")}"]`)
		await type(name, "   ")
		await type(element<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`), "orphan")
		await focus(element("#mcp-url"))
		await submit()

		expect(element<HTMLElement>("#mcp-headers-error").textContent).toBe(t("mcp.errorSecret"))
		expect(name.getAttribute("aria-invalid")).toBe("true")
		expect(document.activeElement === name).toBe(true)
		expect(requests).toEqual([])
	})

	test("focuses an orphaned edit header instead of a stored name left blank", async () => {
		await renderDialog(SERVER)
		await click(element(`[aria-label="${t("mcp.edit")}"]`))
		await click(dialogButton(t("mcp.addHeader")))
		const names = [...document.querySelectorAll<HTMLInputElement>(`[aria-label="${t("mcp.headerName")}"]`)]
		const orphanName = names.at(-1)
		if (!orphanName) throw new Error("orphan header row not rendered")
		await type(orphanName, "   ")
		const orphanValue = [...document.querySelectorAll<HTMLInputElement>(`[aria-label="${t("mcp.headerValue")}"]`)].at(
			-1,
		)
		if (!orphanValue) throw new Error("orphan header value not rendered")
		await type(orphanValue, "orphan")

		await submit()

		expect(requests).toEqual([])
		expect(element<HTMLElement>("#mcp-headers-error").textContent).toBe(t("mcp.errorSecret"))
		expect(orphanName.getAttribute("aria-invalid")).toBe("true")
		expect(orphanName.getAttribute("aria-describedby")).toBe("mcp-headers-error")
		expect(document.activeElement === orphanName).toBe(true)
	})
})
