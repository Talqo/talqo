import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { Route } = await import("./agent.$agentId")
const { LanguageProvider } = await import("@/lib/use-language")
const { EMBED_FORM_DEFAULTS } = await import("@/features/embeds/embed-appearance-form")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const AgentConfigPage = Route.options.component ?? (() => null)

const AGENT_ID = "agent-1"
const TIMESTAMP = "2026-01-01T00:00:00.000Z"
const INITIAL_AGENT = {
	id: AGENT_ID,
	name: "Support agent",
	systemPrompt: "Answer support questions.",
	wordBlacklist: ["seed-term"],
	createdAt: TIMESTAMP,
	updatedAt: TIMESTAMP,
}
const EMBED = {
	id: "embed-1",
	agentId: AGENT_ID,
	name: "Storefront",
	embedToken: "embed-token",
	accessVersion: 1,
	isDisabled: false,
	appearance: EMBED_FORM_DEFAULTS,
}

type RequestRecord = { url: string; method: string; body?: unknown }

let agent: typeof INITIAL_AGENT
let canonicalAgent: typeof INITIAL_AGENT
let canRead: boolean
let embeds: Array<typeof EMBED>
let embedsResponse: Promise<Response> | undefined
let updateFailures: Response[]
let deleteFailures: Response[]
let requests: RequestRecord[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let router: ReturnType<typeof makeRouter>

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function parseJsonBody(body: BodyInit | null | undefined): unknown {
	if (typeof body !== "string") throw new Error("Expected a JSON request body")
	return JSON.parse(body)
}

async function respond(request: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url
	const method = init?.method ?? "GET"
	requests.push({ url, method, body: init?.body ? parseJsonBody(init.body) : undefined })

	if (url === "/api/agents") {
		return json({
			agents: [
				{
					id: "read-only-agent",
					name: "Read-only agent",
					createdAt: TIMESTAMP,
					updatedAt: TIMESTAMP,
					permissions: ["agents:read"],
				},
				...(canRead
					? [
							{
								id: AGENT_ID,
								name: agent.name,
								createdAt: TIMESTAMP,
								updatedAt: TIMESTAMP,
								permissions: ["agents:read", "agents:manage", "agents:delete"],
							},
						]
					: []),
			],
		})
	}
	if (url === `/api/agents/${AGENT_ID}`) {
		if (method === "GET") return json({ agent })
		if (method === "PUT") {
			const failure = updateFailures.shift()
			if (failure) return failure
			agent = canonicalAgent
			return json({ agent })
		}
		if (method === "DELETE") {
			const failure = deleteFailures.shift()
			return failure ?? new Response(null, { status: 204 })
		}
	}
	if (url === `/api/embeds?agentId=${AGENT_ID}`) {
		return embedsResponse ?? json({ embeds })
	}
	throw new Error(`Unexpected request ${method} ${url}`)
}

function makeRouter() {
	const rootRoute = createRootRoute()
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/agent/$agentId",
		validateSearch: Route.options.validateSearch,
		component: AgentConfigPage,
	})
	const list = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/agents",
		component: () => <h1>{t("agents.heading")}</h1>,
	})
	return createRouter({
		routeTree: rootRoute.addChildren([detail, list]),
		history: createMemoryHistory({ initialEntries: [`/dashboard/agent/${AGENT_ID}`] }),
	})
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPage() {
	router = makeRouter()
	await act(async () => {
		await router.load()
		root.render(
			<QueryClientProvider client={queryClient}>
				<LanguageProvider>
					<RouterProvider router={router} />
				</LanguageProvider>
			</QueryClientProvider>,
		)
	})
	await settle()
	await settle()
}

function button(name: string, scope: ParentNode = host): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find(
		(element) => element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
	)
	if (!found) throw new Error(`Button "${name}" not rendered`)
	return found
}

function nameInput(): HTMLInputElement {
	const input = host.querySelector<HTMLInputElement>("#config-name")
	if (!input) throw new Error("Name field not rendered")
	return input
}

function promptInput(): HTMLTextAreaElement {
	const input = host.querySelector<HTMLTextAreaElement>("#config-system-prompt")
	if (!input) throw new Error("Prompt field not rendered")
	return input
}

function blacklistInput(): HTMLInputElement {
	const input = host.querySelector<HTMLInputElement>("#config-blacklist")
	if (!input) throw new Error("Blacklist field not rendered")
	return input
}

function blacklistTerms(): string[] {
	const list = [...host.querySelectorAll("ul")].find(
		(element) => element.getAttribute("aria-label") === t("blacklist.termsLabel"),
	)
	return list ? [...list.querySelectorAll("li")].map((item) => item.textContent ?? "") : []
}

function deleteDialog(): HTMLElement {
	const found = document.querySelector<HTMLElement>("[role='alertdialog']")
	if (!found) throw new Error("Delete dialog not open")
	return found
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
	await settle()
}

async function typeInto(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
	const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
	await act(async () => {
		Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
	await settle()
}

function embedRequestCount(): number {
	return requests.filter(({ method, url }) => method === "GET" && url.startsWith("/api/embeds")).length
}

beforeEach(() => {
	agent = { ...INITIAL_AGENT, wordBlacklist: [...INITIAL_AGENT.wordBlacklist] }
	canonicalAgent = agent
	canRead = true
	embeds = []
	embedsResponse = undefined
	updateFailures = []
	deleteFailures = []
	requests = []
	spyOn(globalThis, "fetch").mockImplementation(respond as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	queryClient.clear()
	mock.restore()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
})

describe("agent detail access and editing", () => {
	test("clears protected content and bypasses the dirty guard when read access is revoked", async () => {
		await renderPage()
		expect(nameInput().value).toBe(INITIAL_AGENT.name)
		const protectedKeys = [
			["/api/agents/agent-1/files"],
			["/api/agents/agent-1/mcp-servers"],
			["/api/embeds/embed-1"],
			["/api/conversations/conversation-1"],
			["/api/stats", { days: 7 }],
		]
		for (const key of protectedKeys) queryClient.setQueryData(key, { private: true })
		await typeInto(nameInput(), "Unsaved agent name")
		await act(async () => {
			void router.navigate({ to: "/dashboard/agents" })
		})
		await settle()
		expect(router.state.location.pathname).toBe(`/dashboard/agent/${AGENT_ID}`)
		expect(deleteDialog().textContent).toContain(t("common.discardTitle"))
		await click(button(t("common.keepEditing"), deleteDialog()))
		using navigate = spyOn(router, "navigate")

		canRead = false
		await act(async () => {
			await queryClient.refetchQueries({ queryKey: ["/api/agents"] })
		})
		await settle()
		await settle()

		expect(navigate).toHaveBeenCalledWith({
			to: "/dashboard/agents",
			replace: true,
			ignoreBlocker: true,
		})
		expect(router.state.location.pathname).toBe("/dashboard/agents")
		expect(host.querySelector("h1")?.textContent).toBe(t("agents.heading"))
		expect(host.querySelector("#config-name") === null).toBe(true)
		expect(host.textContent).not.toContain(INITIAL_AGENT.systemPrompt)
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		for (const key of protectedKeys) expect(queryClient.getQueryData(key)).toBeUndefined()
	})

	test("preserves edits across failed saves and resets to the canonical agent after retry", async () => {
		agent = { ...INITIAL_AGENT, wordBlacklist: ["retained-term", "seed-term"] }
		canonicalAgent = {
			...INITIAL_AGENT,
			name: "Canonical agent",
			systemPrompt: "Canonical instructions.",
			wordBlacklist: ["canonical-term"],
		}
		updateFailures = [
			json({ code: "agent-name-taken", type: "https://docs.talqo.chat/problems#agent-name-taken" }, 409),
			json({}, 500),
		]
		await renderPage()
		await click(button(t("blacklist.removeTerm", { word: "seed-term" })))
		await typeInto(blacklistInput(), "draft-term")
		await click(button(t("blacklist.addTerm")))
		expect(blacklistTerms()).toEqual(["retained-term", "draft-term"])
		expect(button(t("agentConfig.save")).disabled).toBe(false)

		await typeInto(nameInput(), "Draft agent")
		await typeInto(promptInput(), "Draft instructions.")
		await click(button(t("agentConfig.save")))
		expect(host.querySelector("form [role='alert']")?.textContent).toBe(t("agents.nameConflict"))
		expect(nameInput().value).toBe("Draft agent")
		expect(promptInput().value).toBe("Draft instructions.")
		expect(blacklistTerms()).toEqual(["retained-term", "draft-term"])
		expect(host.textContent).not.toContain(t("agentConfig.saved"))

		await click(button(t("agentConfig.save")))
		expect(host.querySelector("form [role='alert']")?.textContent).toBe(t("agents.saveFailed"))
		expect(nameInput().value).toBe("Draft agent")
		expect(promptInput().value).toBe("Draft instructions.")
		expect(blacklistTerms()).toEqual(["retained-term", "draft-term"])

		await click(button(t("agentConfig.save")))
		const updates = requests.filter(({ method }) => method === "PUT")
		expect(updates).toHaveLength(3)
		for (const update of updates) {
			expect(update.body).toEqual({
				name: "Draft agent",
				systemPrompt: "Draft instructions.",
				wordBlacklist: ["retained-term", "draft-term"],
			})
		}
		expect(nameInput().value).toBe("Canonical agent")
		expect(promptInput().value).toBe("Canonical instructions.")
		expect(blacklistTerms()).toEqual(["canonical-term"])
		expect(host.textContent).toContain(t("agentConfig.saved"))
		expect(button(t("agentConfig.save")).disabled).toBe(true)

		await typeInto(nameInput(), "Another draft")
		expect(host.textContent).not.toContain(t("agentConfig.saved"))
		expect(button(t("agentConfig.save")).disabled).toBe(false)
	})
})

describe("agent deletion", () => {
	test("disables deletion while embeds load and while an embed exists", async () => {
		const pendingEmbeds = Promise.withResolvers<Response>()
		embedsResponse = pendingEmbeds.promise
		await renderPage()
		expect(button(t("agentConfig.deleteAgent")).disabled).toBe(true)

		embeds = [EMBED]
		await act(async () => pendingEmbeds.resolve(json({ embeds })))
		await settle()
		await settle()

		expect(button(t("agentConfig.deleteAgent")).disabled).toBe(true)
		expect(host.textContent).toContain(t("agentConfig.deleteBlockedByEmbeds", { count: 1 }))
	})

	test("keeps a failed deletion open, refreshes embeds, then bypasses the dirty guard on success", async () => {
		deleteFailures = [json({}, 500)]
		await renderPage()
		await typeInto(nameInput(), "Unsaved agent name")
		await click(button(t("agentConfig.deleteAgent")))
		const confirmation = deleteDialog().querySelector("input")
		if (!(confirmation instanceof HTMLInputElement)) throw new Error("Delete confirmation field not rendered")
		await typeInto(confirmation, INITIAL_AGENT.name)
		const embedsBeforeDelete = embedRequestCount()

		await click(button(t("agentConfig.deleteConfirm"), deleteDialog()))
		expect(deleteDialog().textContent).toContain(t("agents.deleteFailed"))
		expect(embedRequestCount()).toBe(embedsBeforeDelete + 1)
		expect(nameInput().value).toBe("Unsaved agent name")
		expect(router.state.location.pathname).toBe(`/dashboard/agent/${AGENT_ID}`)

		await click(button(t("agentConfig.deleteConfirm"), deleteDialog()))
		expect(router.state.location.pathname).toBe("/dashboard/agents")
		expect(host.querySelector("h1")?.textContent).toBe(t("agents.heading"))
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
	})
})
