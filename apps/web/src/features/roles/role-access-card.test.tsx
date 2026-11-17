import type { ListRoleAgents200 } from "@/api/generated/models/roles/listRoleAgents200.zod"
import type { QueryClient } from "@/testing/component-harness"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root, settle } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { RoleAccessCard } = await import("./role-access-card")
const { createRouter, createRootRoute, createMemoryHistory, RouterProvider } = await import("@tanstack/react-router")
const { t } = await import("i18next")

type Agent = ListRoleAgents200["agents"][number]
type Permission = Agent["permissions"][number]
const ALL: Permission[] = ["stats:read", "conversations:read", "agents:read", "agents:manage", "agents:delete"]
let agents: Agent[]
let agentsAfterRefresh: Agent[] | undefined
let dirtyCalls: boolean[]
let mutations: { method: string; body?: string }[]
let gets: string[]
let failure: Response | undefined
let getFailure: Response | undefined
let refreshResponse: Promise<Response> | undefined
let mutationGate: Promise<void> | undefined
let host: HTMLDivElement
let root: Root
let client: InstanceType<typeof QueryClient>
let harness: ReturnType<typeof createTestHarness>

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

async function failSave() {
	failure = json(
		{ code: "permission-exceeds-own", type: "https://docs.talqo.chat/problems#permission-exceeds-own" },
		403,
	)
	await render()
	await click(permissionSwitch("stats:read"))
	await click(button(t("agentAccess.save")))
	expect(host.querySelector("[role=alert]")).not.toBeNull()
}

function combobox(): HTMLElement {
	const trigger = host.querySelector<HTMLElement>("[role=combobox]")
	if (!trigger) throw new Error("Missing agent picker")
	return trigger
}

function editor(): HTMLFieldSetElement {
	const found = host.querySelector<HTMLFieldSetElement>("fieldset[tabindex='-1']")
	if (!found) throw new Error("Missing permission editor")
	return found
}

function dialogButton(label: string): HTMLButtonElement {
	const dialog = document.querySelector<HTMLElement>("[role=alertdialog]")
	const found = [...(dialog?.querySelectorAll("button") ?? [])].find((element) => element.textContent?.trim() === label)
	if (!found) throw new Error(`Missing dialog button ${label}`)
	return found
}

async function pressEscape() {
	await act(async () => {
		document.activeElement?.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
		)
	})
	await settle()
}

function optionLabels(): (string | undefined)[] {
	return [...document.querySelectorAll("[role=option]")].map((option) => option.textContent?.trim())
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
	agentsAfterRefresh = undefined
	mutationGate = undefined
	harness = createTestHarness({
		fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			const method = init?.method ?? "GET"
			if (method === "GET") {
				gets.push(url)
				return getFailure ?? refreshResponse ?? json({ agents: agentsAfterRefresh ?? agents })
			}
			mutations.push({ method, body: typeof init?.body === "string" ? init.body : undefined })
			if (mutationGate) await mutationGate
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
		}) as typeof fetch,
	})
	;({ host, root, queryClient: client } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("RoleAccessCard", () => {
	test("directs an empty existing grant to removal instead of Save", async () => {
		await render()
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
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

	test("clears protected content when access to an agent disappears on refresh", async () => {
		agents = [...agents, { id: "extra", name: "Extra bot", permissions: ALL, rolePermissions: ["stats:read"] }]
		await render()
		client.setQueryData(["/api/agents/agent"], { private: true })
		agentsAfterRefresh = agents.filter(({ id }) => id !== "support")
		await confirmRemoval()
		expect(client.getQueryData(["/api/agents/agent"])).toBeUndefined()
	})

	test("clears protected content when a grant loses some of its permissions", async () => {
		await render(["stats:read", "conversations:read"])
		client.setQueryData(["/api/agents/agent"], { private: true })
		agentsAfterRefresh = [{ ...agentAt(0), permissions: ["stats:read"] }, ...agents.slice(1)]
		await click(permissionSwitch("conversations:read"))
		await click(button(t("agentAccess.save")))
		expect(client.getQueryData(["/api/agents/agent"])).toBeUndefined()
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
		expect(host.textContent).not.toContain(t("agentAccess.useRemove"))
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
		expect(host.querySelector("[role=alert]")).toBeNull()
	})

	test("clears the dirty flag when the card unmounts", async () => {
		await render()
		expect(dirtyCalls.at(-1)).toBe(false)
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
		await click(permissionSwitch("conversations:read"))

		await confirmRemoval()

		expect(host.textContent).toContain(t("agentAccess.removed"))
		expect([...host.querySelectorAll("button")].some((element) => element.textContent?.trim() === "Support bot")).toBe(
			false,
		)
		expect(document.activeElement).toBe(host.querySelector("[role=combobox]"))
	})

	test("disables removal when the grant contains a permission the caller does not hold", async () => {
		agents[0] = { ...agentAt(0), rolePermissions: ["agents:read", "agents:manage"] }
		await render(["agents:read", "stats:read", "conversations:read", "agents:delete"])

		expect(permissionSwitch("agents:manage").getAttribute("aria-checked")).toBe("true")
		expect(permissionSwitch("agents:manage").disabled).toBe(true)
		expect(button(t("agentAccess.remove")).disabled).toBe(true)
	})

	test("explains an agentless team without offering access controls", async () => {
		agents = []
		await render()

		expect(host.textContent).toContain(t("agentAccess.noAgents"))
		expect(host.querySelector("[role=combobox]")).toBeNull()
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
		expect(document.querySelector("[role=alertdialog]")).toBeNull()

		await click(button(t("agentAccess.remove")))
		expect(document.querySelector("[role=alertdialog] [role=alert]")).toBeNull()
	})

	test("keeps protected content when a save preserves every existing permission", async () => {
		await render()
		client.setQueryData(["/api/agents/agent"], { private: true })

		await click(permissionSwitch("stats:read"))
		await click(button(t("agentAccess.save")))

		expect(client.getQueryData(["/api/agents/agent"])).toEqual({ private: true })
	})

	test("labels the card, the agent list, and the add picker", async () => {
		await render()

		expect(host.textContent).toContain(t("agentAccess.title"))
		expect(host.querySelector("legend")?.textContent).toBe(t("agentAccess.agents"))
		expect(combobox().getAttribute("aria-label")).toBe(t("agentAccess.addAgent"))
		expect(combobox().textContent).toContain(t("agentAccess.addAgent"))
	})

	test("describes each permission switch and the selected agent", async () => {
		await render()

		expect(editor().tabIndex).toBe(-1)
		expect(host.querySelectorAll("legend")[1]?.textContent).toBe(
			t("agentAccess.permissionsFor", { agent: "Support bot" }),
		)
		const descriptionId = permissionSwitch("stats:read").getAttribute("aria-describedby") ?? ""
		expect(document.getElementById(descriptionId)?.textContent).toBe(t("agentAccess.descriptions.statistics"))
	})

	test("marks only the selected agent as pressed", async () => {
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await render()

		expect(button("Support bot").getAttribute("aria-pressed")).toBe("true")
		expect(button("Observers bot").getAttribute("aria-pressed")).toBe("false")
		await click(button("Observers bot"))
		expect(button("Observers bot").getAttribute("aria-pressed")).toBe("true")
		expect(button("Support bot").getAttribute("aria-pressed")).toBe("false")
	})

	test("offers only agents without access in the picker", async () => {
		agents = [...agents, { id: "third", name: "Third bot", permissions: ALL, rolePermissions: [] }]
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await render()

		await click(combobox())

		expect(optionLabels()).toEqual(["Third bot"])
	})

	test("focuses the permissions editor after adding an agent", async () => {
		agents = [...agents, { id: "third", name: "Third bot", permissions: ALL, rolePermissions: [] }]
		await render()

		await chooseAgent("Observers bot")

		expect(editor().contains(document.activeElement)).toBe(true)
	})

	test("returns focus to the add picker whenever it closes without a choice", async () => {
		agents = [...agents, { id: "third", name: "Third bot", permissions: ALL, rolePermissions: [] }]
		await render()

		await click(combobox())
		await pressEscape()
		expect(document.activeElement).toBe(combobox())

		await chooseAgent("Observers bot")
		await click(combobox())
		await pressEscape()
		expect(document.activeElement).toBe(combobox())
	})

	test("announces loading while agent access is still arriving", async () => {
		const response = Promise.withResolvers<Response>()
		refreshResponse = response.promise
		await render()

		expect(host.textContent).toContain(t("agentAccess.loading"))

		response.resolve(json({ agents }))
		refreshResponse = undefined
		await settle()
		expect(combobox()).not.toBeNull()
	})

	test("keeps another agent's draft when one draft reverts", async () => {
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await render()

		await click(permissionSwitch("conversations:read"))
		await click(button("Observers bot"))
		await click(permissionSwitch("conversations:read", "observers"))
		await click(button("Support bot"))
		await click(permissionSwitch("conversations:read"))

		await click(button("Observers bot"))
		expect(permissionSwitch("conversations:read", "observers").getAttribute("aria-checked")).toBe("true")
		expect(button(t("agentAccess.save")).disabled).toBe(false)
	})

	test.each([
		["agents:manage", ["agents:manage", "agents:read"]],
		["agents:delete", ["agents:delete", "agents:read"]],
	] as const)("saves implied view access alongside %s", async (permission, expected) => {
		await render()
		await chooseAgent("Observers bot")
		await click(permissionSwitch(permission, "observers"))
		await click(button(t("agentAccess.save")))

		const body = JSON.parse(mutations[0]?.body ?? "{}") as { permissions: Permission[] }
		const byName = (a: Permission, b: Permission) => a.localeCompare(b)
		expect(body.permissions.toSorted(byName)).toEqual(expected.toSorted(byName))
	})

	test("saves only the granted permission when it implies none other", async () => {
		await render()
		await chooseAgent("Observers bot")
		await click(permissionSwitch("stats:read", "observers"))
		await click(button(t("agentAccess.save")))

		expect(JSON.parse(mutations[0]?.body ?? "{}")).toEqual({ permissions: ["stats:read"] })
	})

	test("clears the saved confirmation and dirty flag as editing continues", async () => {
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await render()
		await click(permissionSwitch("stats:read"))
		const save = button(t("agentAccess.save"))
		save.focus()
		await click(save)

		expect(host.textContent).toContain(t("agentAccess.saved"))
		expect(dirtyCalls.at(-1)).toBe(false)
		expect(button(t("agentAccess.save")).disabled).toBe(true)
		expect(document.activeElement).toBe(save)

		await click(permissionSwitch("conversations:read"))
		expect(host.textContent).not.toContain(t("agentAccess.saved"))

		await click(button(t("agentAccess.save")))
		expect(host.textContent).toContain(t("agentAccess.saved"))

		await click(button("Observers bot"))
		expect(host.textContent).not.toContain(t("agentAccess.saved"))
	})

	test("clears a failed save when the selection changes", async () => {
		agents = [...agents, { id: "third", name: "Third bot", permissions: ALL, rolePermissions: [] }]
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await failSave()

		await click(button("Observers bot"))
		expect(host.querySelector("[role=alert]")).toBeNull()

		await click(button("Support bot"))
		await click(button(t("agentAccess.save")))
		expect(host.querySelector("[role=alert]")).not.toBeNull()

		await chooseAgent("Third bot")
		expect(host.querySelector("[role=alert]")).toBeNull()
	})

	test("clears the saved confirmation when the picker adds an agent", async () => {
		await render()
		await click(permissionSwitch("stats:read"))
		await click(button(t("agentAccess.save")))
		expect(host.textContent).toContain(t("agentAccess.saved"))

		await chooseAgent("Observers bot")
		expect(host.textContent).not.toContain(t("agentAccess.saved"))
	})

	test("clears a failed save when removal is confirmed", async () => {
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await failSave()

		failure = undefined
		await confirmRemoval()
		expect(host.querySelector("[role=alert]")).toBeNull()
	})

	test("clears the saved confirmation when removal fails", async () => {
		await render()
		await click(permissionSwitch("stats:read"))
		await click(button(t("agentAccess.save")))
		expect(host.textContent).toContain(t("agentAccess.saved"))

		failure = json(
			{ code: "internal-server-error", type: "https://docs.talqo.chat/problems#internal-server-error" },
			500,
		)
		await click(button(t("agentAccess.remove")))
		await click(dialogButton(t("agentAccess.remove")))
		await click(dialogButton(t("agentConfig.cancel")))

		expect(host.textContent).not.toContain(t("agentAccess.saved"))
	})

	test("closes the removal dialog after access is removed", async () => {
		agents[1] = { ...agentAt(1), rolePermissions: ["stats:read"] }
		await render()
		await confirmRemoval()

		expect(document.querySelector("[role=alertdialog]")).toBeNull()
		expect(host.textContent).toContain(t("agentAccess.removed"))
		expect(permissionSwitch("stats:read", "observers").getAttribute("aria-checked")).toBe("true")
	})

	test("labels the removal confirmation and shows the pending action", async () => {
		const blocked = Promise.withResolvers<void>()
		mutationGate = blocked.promise
		await render()
		await click(button(t("agentAccess.remove")))

		const dialog = document.querySelector<HTMLElement>("[role=alertdialog]")
		expect(dialog?.querySelector("[data-slot=dialog-title]")?.textContent).toBe(t("agentAccess.remove"))
		expect(dialog?.querySelector("[data-slot=dialog-description]")?.textContent).toBe(
			t("agentAccess.removePrompt", { agent: "Support bot" }),
		)

		await click(dialogButton(t("agentAccess.remove")))
		expect(document.querySelector("[role=alertdialog]")?.textContent).toContain(t("roles.deleting"))
		expect(dialogButton(t("roles.deleting")).disabled).toBe(true)

		blocked.resolve()
		mutationGate = undefined
		await settle()
		expect(document.querySelector("[role=alertdialog]")).toBeNull()
	})

	test("falls back to a generic message and skips the refresh on a server failure", async () => {
		failure = new Response("boom", { status: 500 })
		await render()
		const refreshesBefore = gets.length

		await confirmRemoval()

		expect(document.querySelector("[role=alertdialog] [role=alert]")?.textContent).toContain(t("auth.errorFallback"))
		expect(gets.length).toBe(refreshesBefore)
	})

	test("discards a new agent's draft when cancelled", async () => {
		await render()
		await chooseAgent("Observers bot")
		await click(permissionSwitch("stats:read", "observers"))
		expect(dirtyCalls.at(-1)).toBe(true)

		await click(button(t("agentConfig.cancel")))
		expect(dirtyCalls.at(-1)).toBe(false)
		expect(host.textContent).not.toContain(t("agentAccess.permissionsFor", { agent: "Observers bot" }))
	})
})
