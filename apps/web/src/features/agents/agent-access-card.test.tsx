import type { GetAgentAccess200 } from "@/api/generated/models/roles/getAgentAccess200.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { AgentAccessCard } = await import("./agent-access-card")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRouter, createRootRoute, createMemoryHistory, RouterProvider } = await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

type Permission = GetAgentAccess200["roles"][number]["permissions"][number]
const ALL: Permission[] = ["stats:read", "conversations:read", "agents:read", "agents:manage", "agents:delete"]
let roles: GetAgentAccess200["roles"]
let mutations: { method: string; body?: string }[]
let failure: Response | undefined
let refreshResponse: Promise<Response> | undefined
let host: HTMLDivElement
let root: Root
let client: InstanceType<typeof QueryClient>

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function render(permissions: Permission[] = ALL) {
	const route = createRootRoute({ component: () => <AgentAccessCard agentId="agent" permissions={permissions} /> })
	const router = createRouter({ routeTree: route, history: createMemoryHistory() })
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		),
	)
	await settle()
	await settle()
}

function button(name: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)
	if (!found) throw new Error(`Missing button ${name}`)
	return found
}

function checkbox(permission: Permission): HTMLElement {
	const label = host.querySelector<HTMLLabelElement>(`label[for="access-${permission}"]`)
	const found = label ? host.querySelector<HTMLElement>(`[role=checkbox][aria-labelledby="${label.id}"]`) : null
	if (!found) throw new Error(`Missing checkbox ${permission}`)
	return found
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
}

beforeEach(() => {
	roles = [
		{ id: "support", name: "Support", permissions: ["agents:read"] },
		{ id: "observers", name: "Observers", permissions: [] },
	]
	mutations = []
	failure = undefined
	refreshResponse = undefined
	spyOn(window, "confirm").mockReturnValue(true)
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const method = init?.method ?? "GET"
		if (method === "GET") return refreshResponse ?? json({ roles })
		mutations.push({ method, body: typeof init?.body === "string" ? init.body : undefined })
		if (failure) return failure
		const selected = roles.find((role) => url.endsWith(`/${role.id}`))
		if (!selected) throw new Error("Unknown role")
		if (method === "DELETE") selected.permissions = []
		else {
			if (typeof init?.body !== "string") throw new Error("Missing body")
			const body = JSON.parse(init.body) as { permissions: Permission[] }
			selected.permissions = body.permissions
		}
		return new Response(null, { status: 204 })
	}) as typeof fetch)
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

describe("AgentAccessCard", () => {
	test("preserves each role's draft while showing only the selected role's permissions", async () => {
		roles[1] = { id: "observers", name: "Observers", permissions: ["stats:read"] }
		await render()
		await click(checkbox("agents:manage"))
		expect(checkbox("agents:read").getAttribute("aria-disabled")).toBe("true")
		await click(button("Observers"))
		expect(checkbox("stats:read").getAttribute("aria-checked")).toBe("true")
		expect(checkbox("agents:manage").getAttribute("aria-checked")).toBe("false")
		await click(button("Support"))
		expect(checkbox("agents:manage").getAttribute("aria-checked")).toBe("true")
		expect(mutations).toEqual([])
	})

	test("does not grant a newly selected role access until Save", async () => {
		await render()
		await click(button(t("agentAccess.addRole")))
		const select = host.querySelector("select")
		if (!select) throw new Error("Missing role picker")
		await act(async () => {
			select.value = "observers"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(document.activeElement).toBe(host.querySelector("fieldset"))
		expect(button(t("agentAccess.save")).disabled).toBe(true)
		await click(checkbox("stats:read"))
		expect(mutations).toEqual([])
		await click(button(t("agentAccess.save")))
		expect(mutations).toEqual([{ method: "PUT", body: JSON.stringify({ permissions: ["stats:read"] }) }])
	})

	test("removes saved access immediately without saving the unsaved checkbox changes", async () => {
		await render()
		await click(checkbox("stats:read"))
		await click(button(t("agentAccess.remove")))
		expect(mutations).toEqual([{ method: "DELETE", body: undefined }])
		expect(host.textContent).toContain(t("agentAccess.empty"))
		expect(host.querySelector("fieldset")).toBeNull()
		expect(document.activeElement).toBe(button(t("agentAccess.addRole")))
	})

	test("keeps editing disabled until saved permissions finish refreshing", async () => {
		await render()
		await click(checkbox("stats:read"))
		const refreshed = Promise.withResolvers<Response>()
		refreshResponse = refreshed.promise
		await click(button(t("agentAccess.save")))
		expect(button(t("roles.saving")).disabled).toBe(true)
		expect(checkbox("stats:read").getAttribute("aria-disabled")).toBe("true")
		expect(button(t("agentAccess.remove")).disabled).toBe(true)
		await act(async () => refreshed.resolve(json({ roles })))
		await settle()
		expect(checkbox("stats:read").getAttribute("aria-checked")).toBe("true")
		expect(host.textContent).toContain(t("agentAccess.saved"))
	})

	test("keeps the draft after a failed save and disables permissions the caller lacks", async () => {
		failure = json(
			{ type: "https://docs.talqo.chat/problems#permission-exceeds-own", code: "permission-exceeds-own" },
			403,
		)
		await render(["agents:read", "stats:read"])
		expect(checkbox("agents:manage").getAttribute("aria-disabled")).toBe("true")
		await click(checkbox("stats:read"))
		await click(button(t("agentAccess.save")))
		expect(checkbox("stats:read").getAttribute("aria-checked")).toBe("true")
		expect(host.querySelector("[role=alert]")).not.toBeNull()
		await click(button(t("agentAccess.addRole")))
		const select = host.querySelector("select")
		if (!select) throw new Error("Missing role picker")
		await act(async () => {
			select.value = "observers"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		expect(host.querySelector("[role=alert]")).toBeNull()
	})
})
