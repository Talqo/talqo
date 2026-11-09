import type { ListRoleAgents200 } from "@/api/generated/models/roles/listRoleAgents200.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { RoleAccessCard } = await import("./role-access-card")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRouter, createRootRoute, createMemoryHistory, RouterProvider } = await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

type Agent = ListRoleAgents200["agents"][number]
type Permission = Agent["permissions"][number]
const ALL: Permission[] = ["stats:read", "conversations:read", "agents:read", "agents:manage", "agents:delete"]
let agents: Agent[]
let dirtyCalls: boolean[]
let mutations: { method: string; body?: string }[]
let gets: string[]
let failure: Response | undefined
let getFailure: Response | undefined
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

function agentAt(index: number): Agent {
	const agent = agents[index]
	if (!agent) throw new Error(`Missing agent ${index}`)
	return agent
}

async function render(permissions: Permission[] = ALL) {
	if (agents.length > 0) agents[0] = { ...agentAt(0), permissions }
	const route = createRootRoute({
		component: () => <RoleAccessCard roleId="role" onDirtyChange={(dirty) => dirtyCalls.push(dirty)} />,
	})
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

function permissionSwitch(permission: Permission, agentId = "support"): HTMLButtonElement {
	const found = document.getElementById(`access-role-${agentId}-${permission}`)
	if (!(found instanceof HTMLButtonElement) || found.getAttribute("role") !== "switch")
		throw new Error(`Missing switch ${permission}`)
	return found
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
}

async function chooseAgent(name: string) {
	const trigger = host.querySelector<HTMLElement>("[role=combobox]")
	if (!trigger) throw new Error("Missing agent picker")
	await click(trigger)
	const item = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
		(element) => element.textContent?.trim() === name,
	)
	if (!item) throw new Error(`Missing ${name} option`)
	await click(item)
}

async function confirmRemoval() {
	await click(button(t("agentAccess.remove")))
	const dialog = document.querySelector<HTMLElement>("[role=alertdialog]")
	const confirm = [...(dialog?.querySelectorAll("button") ?? [])].find(
		(element) => element.textContent?.trim() === t("agentAccess.remove"),
	)
	if (!confirm) throw new Error("Missing removal confirmation")
	await click(confirm)
}

beforeEach(() => {
	agents = [
		{
			id: "support",
			name: "Support bot",
			permissions: ALL,
			rolePermissions: ["agents:read"],
		},
		{ id: "observers", name: "Observers bot", permissions: ALL, rolePermissions: [] },
	]
	dirtyCalls = []
	mutations = []
	gets = []
	failure = undefined
	getFailure = undefined
	refreshResponse = undefined
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const method = init?.method ?? "GET"
		if (method === "GET") {
			gets.push(url)
			return getFailure ?? refreshResponse ?? json({ agents })
		}
		mutations.push({ method, body: typeof init?.body === "string" ? init.body : undefined })
		if (failure) return failure
		const selected = agents.find((agent) => url.endsWith(`/agents/${agent.id}`))
		if (!selected) throw new Error("Unknown agent")
		if (method === "DELETE") selected.rolePermissions = []
		else {
			if (typeof init?.body !== "string") throw new Error("Missing body")
			const body = JSON.parse(init.body) as { permissions: Permission[] }
			selected.rolePermissions = body.permissions
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

describe("RoleAccessCard", () => {
	test("directs an empty existing grant to removal instead of Save", async () => {
		await render()
		expect(host.textContent).not.toContain(t("agentAccess.saved"))
		expect(host.textContent).not.toContain(t("agentAccess.removed"))
		expect(host.textContent).not.toContain(t("agentAccess.useRemove"))
		expect(
			[...host.querySelectorAll("button")].some((element) => element.textContent?.trim() === t("agentConfig.cancel")),
		).toBe(false)
		await click(permissionSwitch("agents:read"))
		expect(button(t("agentAccess.save")).disabled).toBe(true)
		expect(host.textContent).toContain(t("agentAccess.useRemove"))
		expect(button(t("agentAccess.remove")).disabled).toBe(false)
		expect(mutations).toEqual([])
	})

	test("reconciles deleted agents and their drafts when access is refreshed", async () => {
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await render()
		await click(permissionSwitch("conversations:read"))
		agents = agents.filter(({ id }) => id !== "support")
		await act(async () => client.refetchQueries())
		await settle()
		expect(button("Observers bot").getAttribute("aria-pressed")).toBe("true")
		expect(permissionSwitch("stats:read", "observers").getAttribute("aria-checked")).toBe("true")
		expect(host.textContent).not.toContain(t("agentAccess.empty"))
		expect(button(t("agentAccess.save")).disabled).toBe(true)
	})

	test("shows the latest operation's failure and keeps the draft", async () => {
		await render()
		const refreshesBeforeSave = gets.length
		await click(permissionSwitch("stats:read"))
		failure = json(
			{ code: "permission-exceeds-own", type: "https://docs.talqo.chat/problems#permission-exceeds-own" },
			403,
		)
		await click(button(t("agentAccess.save")))
		expect(host.querySelector("[role=alert]")?.textContent).toContain(t("problems.permission-exceeds-own"))
		expect(gets.length).toBeGreaterThan(refreshesBeforeSave)
		failure = json({ code: "role-not-found", type: "https://docs.talqo.chat/problems#role-not-found" }, 404)
		const refreshesBeforeRemove = gets.length
		await confirmRemoval()
		expect(document.querySelector("[role=alertdialog] [role=alert]")?.textContent).toContain(
			t("problems.role-not-found"),
		)
		expect(gets.length).toBeGreaterThan(refreshesBeforeRemove)
		expect(permissionSwitch("stats:read").getAttribute("aria-checked")).toBe("true")
		expect(mutations.map(({ method }) => method)).toEqual(["PUT", "DELETE"])
	})

	test("clears protected content after self-revocation without dropping the access summary", async () => {
		await render()
		const protectedKeys = [
			["/api/agents/agent"],
			["/api/agents/agent/files"],
			["/api/agents/agent/mcp-servers"],
			["/api/stats", { days: 7 }],
			["/api/conversations"],
			["/api/conversations/transcript"],
			["/api/embeds"],
			["/api/embeds/embed"],
		]
		for (const key of protectedKeys) client.setQueryData(key, { private: true })
		client.setQueryData(["/api/agents"], { agents: [] })
		client.setQueryData(["/api/auth/session"], { user: "operator" })
		agents[0] = { ...agentAt(0), permissions: [] }
		await confirmRemoval()
		for (const key of protectedKeys) expect(client.getQueryData(key)).toBeUndefined()
		expect(client.getQueryData(["/api/agents"])).toEqual({ agents: [] })
		expect(client.getQueryData(["/api/auth/session"])).toEqual({ user: "operator" })
	})

	test("preserves each agent's draft while showing only the selected agent's permissions", async () => {
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await render()
		await click(permissionSwitch("agents:manage"))
		expect(permissionSwitch("agents:read").disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.includedWith", { permission: t("agentAccess.editConfiguration") }))
		await click(button("Observers bot"))
		expect(permissionSwitch("stats:read", "observers").getAttribute("aria-checked")).toBe("true")
		expect(permissionSwitch("agents:manage", "observers").getAttribute("aria-checked")).toBe("false")
		await click(button("Support bot"))
		expect(permissionSwitch("agents:manage").getAttribute("aria-checked")).toBe("true")
		await click(permissionSwitch("agents:manage"))
		await click(permissionSwitch("agents:delete"))
		expect(permissionSwitch("agents:read").disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.includedWith", { permission: t("agentAccess.deleteAgent") }))
		expect(mutations).toEqual([])
	})

	test("keeps a new agent selected when its last draft permission is switched off", async () => {
		await render()
		await chooseAgent("Observers bot")
		expect(
			[...host.querySelectorAll("button")].some((element) => element.textContent?.trim() === t("agentAccess.remove")),
		).toBe(false)
		await click(permissionSwitch("stats:read", "observers"))
		await click(permissionSwitch("stats:read", "observers"))
		expect(button("Observers bot").getAttribute("aria-pressed")).toBe("true")
		expect(button(t("agentAccess.save")).disabled).toBe(true)
		expect(permissionSwitch("stats:read", "observers").getAttribute("aria-checked")).toBe("false")
		await click(button(t("agentConfig.cancel")))
		expect(host.textContent).not.toContain(t("agentAccess.permissionsFor", { agent: "Observers bot" }))
		expect(mutations).toEqual([])
	})

	test("keeps editing disabled until saved permissions finish refreshing", async () => {
		await render()
		await click(permissionSwitch("stats:read"))
		const refreshed = Promise.withResolvers<Response>()
		refreshResponse = refreshed.promise
		await click(button(t("agentAccess.save")))
		expect(button(t("roles.saving")).disabled).toBe(true)
		expect(permissionSwitch("stats:read").disabled).toBe(true)
		expect(button(t("agentAccess.remove")).disabled).toBe(true)
		expect(host.querySelector<HTMLButtonElement>("[role=combobox]")?.disabled).toBe(true)
		await act(async () => refreshed.resolve(json({ agents })))
		await settle()
		expect(permissionSwitch("stats:read").getAttribute("aria-checked")).toBe("true")
		expect(host.textContent).toContain(t("agentAccess.saved"))
	})

	test("keeps the draft after a failed save and disables permissions the caller lacks", async () => {
		failure = json(
			{ type: "https://docs.talqo.chat/problems#permission-exceeds-own", code: "permission-exceeds-own" },
			403,
		)
		await render(["agents:read", "stats:read"])
		expect(permissionSwitch("agents:manage").disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.notYours"))
		await click(permissionSwitch("stats:read"))
		await click(button(t("agentAccess.save")))
		expect(permissionSwitch("stats:read").getAttribute("aria-checked")).toBe("true")
		expect(host.querySelector("[role=alert]")).not.toBeNull()
		await chooseAgent("Observers bot")
		expect(host.querySelector("[role=alert]") === null).toBe(true)
	})

	test("clears the dirty flag when the card unmounts", async () => {
		await render()
		await click(permissionSwitch("stats:read"))
		expect(dirtyCalls.at(-1)).toBe(true)
		await act(async () => root.render(null))
		expect(dirtyCalls.at(-1)).toBe(false)
	})

	test("shows view access as included when a grant carries manage or delete", async () => {
		agents[0] = { ...agentAt(0), rolePermissions: ["agents:manage"] }
		agents[1] = { ...agentAt(1), rolePermissions: ["agents:delete"] }
		await render()

		const supportRead = permissionSwitch("agents:read")
		expect(supportRead.getAttribute("aria-checked")).toBe("true")
		expect(supportRead.disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.includedWith", { permission: t("agentAccess.editConfiguration") }))

		await click(button("Observers bot"))
		const observersRead = permissionSwitch("agents:read", "observers")
		expect(observersRead.getAttribute("aria-checked")).toBe("true")
		expect(observersRead.disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.includedWith", { permission: t("agentAccess.deleteAgent") }))
		expect(host.querySelector<HTMLButtonElement>("[role=combobox]")?.disabled).toBe(true)
	})

	test("adds implied view access when granting manage and keeps it when manage is revoked", async () => {
		await render()
		await chooseAgent("Observers bot")
		await click(permissionSwitch("agents:manage", "observers"))

		const read = permissionSwitch("agents:read", "observers")
		expect(read.getAttribute("aria-checked")).toBe("true")
		expect(read.disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.includedWith", { permission: t("agentAccess.editConfiguration") }))

		await click(permissionSwitch("agents:manage", "observers"))
		expect(read.getAttribute("aria-checked")).toBe("true")
		expect(read.disabled).toBe(false)

		await click(button(t("agentAccess.save")))
		expect(JSON.parse(mutations[0]?.body ?? "{}")).toEqual({ permissions: ["agents:read"] })
	})

	test("reverts a draft when its permissions match the stored grant again", async () => {
		agents[0] = { ...agentAt(0), rolePermissions: ["stats:read"] }
		await render()

		await click(permissionSwitch("stats:read"))
		expect(button(t("agentAccess.save")).disabled).toBe(true)
		await click(permissionSwitch("stats:read"))
		expect(permissionSwitch("stats:read").getAttribute("aria-checked")).toBe("true")
		expect(button(t("agentAccess.save")).disabled).toBe(true)
		expect(mutations).toEqual([])
	})

	test("returns focus to the add choice after removing the last grant", async () => {
		await render()

		await confirmRemoval()

		expect(host.textContent).toContain(t("agentAccess.removed"))
		expect(document.activeElement).toBe(host.querySelector("[role=combobox]"))
	})

	test("disables removal when the grant contains a permission the caller does not hold", async () => {
		agents[0] = { ...agentAt(0), rolePermissions: ["agents:manage"] }
		await render(["agents:read", "stats:read", "conversations:read", "agents:delete"])

		expect(permissionSwitch("agents:manage").getAttribute("aria-checked")).toBe("true")
		expect(permissionSwitch("agents:manage").disabled).toBe(true)
		expect(button(t("agentAccess.remove")).disabled).toBe(true)
	})

	test("explains an agentless team without offering access controls", async () => {
		agents = []
		await render()

		expect(host.textContent).toContain(t("agentAccess.noAgents"))
		expect(host.querySelector("[role=combobox]") === null).toBe(true)
	})

	test("shows a load failure and retries without reloading the card", async () => {
		getFailure = json({ code: "permission-denied", type: "https://docs.talqo.chat/problems#permission-denied" }, 403)
		await render()

		expect(host.querySelector("[role=alert]")?.textContent).toContain(t("problems.permission-denied"))
		getFailure = undefined
		const before = gets.length
		await click(button(t("common.retry")))

		expect(gets.length).toBeGreaterThan(before)
		expect(button("Support bot").getAttribute("aria-pressed")).toBe("true")
	})

	test("clears a removal failure when the confirmation is cancelled and reopened", async () => {
		await render()
		failure = json(
			{ code: "internal-server-error", type: "https://docs.talqo.chat/problems#internal-server-error" },
			500,
		)
		await confirmRemoval()

		expect(document.querySelector("[role=alertdialog] [role=alert]")?.textContent).toContain(
			t("problems.internal-server-error"),
		)
		const dialog = document.querySelector<HTMLElement>("[role=alertdialog]")
		const cancel = [...(dialog?.querySelectorAll("button") ?? [])].find(
			(element) => element.textContent?.trim() === t("agentConfig.cancel"),
		)
		if (!cancel) throw new Error("cancel not rendered")
		await click(cancel)
		expect(document.querySelector("[role=alertdialog]") === null).toBe(true)

		await click(button(t("agentAccess.remove")))
		expect(document.querySelector("[role=alertdialog] [role=alert]") === null).toBe(true)
	})

	test("keeps protected content when a save preserves every existing permission", async () => {
		await render()
		client.setQueryData(["/api/agents/agent"], { private: true })

		await click(permissionSwitch("stats:read"))
		await click(button(t("agentAccess.save")))

		expect(client.getQueryData(["/api/agents/agent"])).toEqual({ private: true })
	})
})
