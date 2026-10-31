import type { McpServer } from "@/api/generated/models/mcpServer.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ConnectionDialog } = await import("./connection-dialog")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

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

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

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
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	queryClient.clear()
})

describe("ConnectionDialog", () => {
	test("starts from an empty draft every time it opens", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		await type(element<HTMLInputElement>("#mcp-name"), "Stock")

		await click(button(t("common.cancel")))
		await click(button(t("mcp.add")))

		expect(element<HTMLInputElement>("#mcp-name").value).toBe("")
		expect(document.querySelector("#mcp-name-error")).toBeNull()
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
		expect(document.activeElement).toBe(name)
	})

	test("focuses the empty secret value instead of its filled name", async () => {
		await renderDialog()
		await click(button(t("mcp.add")))
		await click(element("#mcp-auth"))
		const headers = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
			(option) => option.textContent === t("mcp.authHeaders"),
		)
		if (!headers) throw new Error("headers option not rendered")
		await click(headers)
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
})
