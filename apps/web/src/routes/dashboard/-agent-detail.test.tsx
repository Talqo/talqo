import { json, parseJsonBody, requestCount } from "@/testing/api-responses"
import { act, createTestHarness, type QueryClient, type Root, settle } from "@/testing/component-harness"
import { click, findButton as button, typeInto } from "@/testing/dom"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

const { Route } = await import("./agent.$agentId")
const { AGENT_NAME_MAX_LENGTH, SYSTEM_PROMPT_MAX_LENGTH } = await import("@/features/agents/agent-schema")
const { EMBED_FORM_DEFAULTS } = await import("@/features/embeds/embed-appearance-form")
const { createMemoryHistory, createRootRoute, createRoute, createRouter } = await import("@tanstack/react-router")
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
let agentPermissions: Array<string>
let agentListFailures: Array<Response>
let agentDetailFailures: Array<Response>
let agentDetailMissing: boolean
let agentDetailResponse: Promise<Response> | undefined
let embeds: Array<typeof EMBED>
let embedsResponse: Promise<Response> | undefined
let embedListFailing: boolean
let createFailures: Array<Response | Promise<Response>>
let createdBodies: Array<Record<string, unknown>>
let updateFailures: Array<Response | Promise<Response>>
let deleteFailures: Array<Response | Promise<Response>>
let requests: Array<RequestRecord>
let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let router: ReturnType<typeof makeRouter>

async function respond(request: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url
	const method = init?.method ?? "GET"
	requests.push({ url, method, body: init?.body ? parseJsonBody(init.body) : undefined })

	if (url === "/api/agents") {
		const failure = agentListFailures.shift()
		if (failure) return failure
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
								permissions: agentPermissions,
							},
						]
					: []),
			],
		})
	}
	if (url === `/api/agents/${AGENT_ID}/files`) {
		return json({ files: [], maxSizeBytes: 10_485_760, maxNameLength: 255, allowedExtensions: [".md"] })
	}
	if (url === `/api/agents/${AGENT_ID}/mcp-servers`) {
		return json({ servers: [], stdioAllowed: false })
	}
	if (url === `/api/agents/${AGENT_ID}`) {
		if (method === "GET") {
			const failure = agentDetailFailures.shift()
			if (failure) return failure
			if (agentDetailMissing) return json({})
			return agentDetailResponse ?? json({ agent })
		}
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
		if (embedListFailing) return json({}, 500)
		return embedsResponse ?? json({ embeds })
	}
	if (url === "/api/embeds" && method === "POST") {
		const body = parseJsonBody(init?.body) as Record<string, unknown>
		createdBodies.push(body)
		const failure = createFailures.shift()
		if (failure) return failure
		const created = { ...EMBED, id: "created-embed", name: String(body.name) }
		embeds = [...embeds, created]
		return json({ embed: created }, 201)
	}
	throw new Error(`Unexpected request ${method} ${url}`)
}

function makeRouter(initialEntry = `/dashboard/agent/${AGENT_ID}`) {
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
	const embedDetail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/embeds/$embedId",
		component: () => <div data-testid="embed-destination" />,
	})
	return createRouter({
		routeTree: rootRoute.addChildren([detail, list, embedDetail]),
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
	})
}

async function renderPage(initialEntry?: string) {
	router = makeRouter(initialEntry)
	await renderRouter(root, queryClient, router)
	await settle()
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

function blacklistTerms(): Array<string> {
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

async function typeDeleteConfirmation() {
	const confirmation = deleteDialog().querySelector("input")
	if (!(confirmation instanceof HTMLInputElement)) throw new Error("Delete confirmation field not rendered")
	await typeInto(confirmation, INITIAL_AGENT.name)
}

function embedRequestCount(): number {
	return requests.filter(({ method, url }) => method === "GET" && url.startsWith("/api/embeds")).length
}

beforeEach(() => {
	agent = { ...INITIAL_AGENT, wordBlacklist: [...INITIAL_AGENT.wordBlacklist] }
	canonicalAgent = agent
	canRead = true
	agentPermissions = ["agents:read", "agents:manage", "agents:delete"]
	agentListFailures = []
	agentDetailFailures = []
	agentDetailMissing = false
	agentDetailResponse = undefined
	embeds = []
	embedsResponse = undefined
	embedListFailing = false
	createFailures = []
	createdBodies = []
	updateFailures = []
	deleteFailures = []
	requests = []
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
})

describe("agent route search", () => {
	const validateSearch = Route.options.validateSearch
	if (typeof validateSearch !== "function") throw new Error("Agent route search validation missing")

	test("keeps a tab the agent page renders", () => {
		expect(validateSearch({ tab: "configuration" })).toEqual({ tab: "configuration" })
		expect(validateSearch({ tab: "embeds" })).toEqual({ tab: "embeds" })
	})

	test("drops a tab the agent page does not render", () => {
		expect(validateSearch({ tab: "unknown" })).toStrictEqual({ tab: undefined })
		expect(validateSearch({})).toStrictEqual({ tab: undefined })
	})
})

describe("agent detail access and editing", () => {
	test("requests no protected data for an agent the operator cannot read", async () => {
		canRead = false
		await renderPage()
		await settle()

		expect(router.state.location.pathname).toBe("/dashboard/agents")
		expect(requests.filter(({ url }) => url === `/api/agents/${AGENT_ID}`)).toHaveLength(0)
		expect(requests.filter(({ url }) => url.startsWith("/api/embeds"))).toHaveLength(0)
	})

	test("shows readers a read-only configuration without management controls", async () => {
		agentPermissions = ["agents:read"]
		await renderPage()

		expect(nameInput().readOnly).toBe(true)
		expect(promptInput().readOnly).toBe(true)
		expect(host.querySelector("#config-blacklist")).toBeNull()
		expect(host.querySelector('label[for="config-blacklist"]')).toBeNull()
		expect(host.textContent).toContain(t("agentFields.wordBlacklist"))
		expect(host.querySelector('a[href="/dashboard/agents"]')?.textContent?.trim()).toBe(t("agentConfig.backToAgents"))
		expect(host.textContent).not.toContain(t("agentConfig.subheading"))
		expect(host.textContent).not.toContain(t("agentConfig.cardDescription"))
		expect(host.textContent).not.toContain(t("agentConfig.dangerZone"))
		expect(
			[...host.querySelectorAll("button")].some((element) => element.textContent?.trim() === t("agentConfig.save")),
		).toBe(false)
		expect(embedRequestCount()).toBe(0)
	})

	test("clears a failed save and announces progress when the operator retries", async () => {
		const pending = Promise.withResolvers<Response>()
		updateFailures = [json({}, 500), pending.promise]
		await renderPage()
		await typeInto(nameInput(), "Renamed agent")

		await click(button(t("agentConfig.save")))
		expect(host.querySelector("form [role='alert']")?.textContent).toBe(t("agents.saveFailed"))

		await click(button(t("agentConfig.save")))
		expect(host.querySelector("form [role='alert']")).toBeNull()
		expect(host.textContent).toContain(t("agentConfig.saving"))
		expect(button(t("agentConfig.saving")).disabled).toBe(true)

		await act(async () => pending.resolve(json({ agent: canonicalAgent })))
		await settle()
		await settle()

		expect(host.textContent).toContain(t("agentConfig.saved"))
		expect(button(t("agentConfig.save")).disabled).toBe(true)
		expect(nameInput().value).toBe(INITIAL_AGENT.name)
	})

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
		expect(host.querySelector("#config-name")).toBeNull()
		expect(host.textContent).not.toContain(INITIAL_AGENT.systemPrompt)
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		for (const key of protectedKeys) expect(queryClient.getQueryData(key)).toBeUndefined()
	})

	test("preserves unsaved edits across a background refetch", async () => {
		await renderPage()
		await typeInto(nameInput(), "Unsaved agent name")
		agent = { ...INITIAL_AGENT, name: "Renamed elsewhere" }

		await act(async () => {
			await queryClient.refetchQueries({ queryKey: [`/api/agents/${AGENT_ID}`] })
		})
		await settle()

		expect(nameInput().value).toBe("Unsaved agent name")
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
		expect(host.textContent).not.toContain(t("agentConfig.saved"))
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

describe("agent configuration validation", () => {
	test("focuses the first invalid field and explains required and over-limit values", async () => {
		await renderPage()
		await typeInto(nameInput(), "")
		await typeInto(promptInput(), "")

		await click(button(t("agentConfig.save")))
		expect(document.activeElement).toBe(nameInput())
		expect(host.querySelector("#config-name-error")?.textContent).toBe(t("agentFields.nameRequired"))
		expect(host.querySelector("#config-system-prompt-error")?.textContent).toBe(t("agentFields.systemPromptRequired"))
		expect(nameInput().getAttribute("aria-invalid")).toBe("true")
		expect(promptInput().getAttribute("aria-invalid")).toBe("true")

		await typeInto(nameInput(), "Valid name")
		await click(button(t("agentConfig.save")))
		expect(document.activeElement).toBe(promptInput())

		await typeInto(nameInput(), "n".repeat(AGENT_NAME_MAX_LENGTH + 1))
		await typeInto(promptInput(), "p".repeat(SYSTEM_PROMPT_MAX_LENGTH + 1))
		await click(button(t("agentConfig.save")))
		expect(host.querySelector("#config-name-error")?.textContent).toBe(
			t("agentFields.nameTooLong", { max: AGENT_NAME_MAX_LENGTH }),
		)
		expect(host.querySelector("#config-system-prompt-error")?.textContent).toBe(
			t("agentFields.systemPromptTooLong", { max: SYSTEM_PROMPT_MAX_LENGTH }),
		)
		expect(requests.filter(({ method }) => method === "PUT")).toHaveLength(0)
	})

	test("labels each field and ties its counter and error to the input", async () => {
		await renderPage()
		expect(host.querySelector('label[for="config-name"]')?.textContent).toBe(t("agentFields.name"))
		expect(host.querySelector('label[for="config-system-prompt"]')?.textContent).toBe(t("agentFields.systemPrompt"))
		expect(host.querySelector('label[for="config-blacklist"]')?.textContent).toBe(t("agentFields.wordBlacklist"))
		expect(nameInput().placeholder).toBe(t("agentFields.namePlaceholder"))
		expect(promptInput().placeholder).toBe(t("agentFields.systemPromptPlaceholder"))
		expect(nameInput().readOnly).toBe(false)
		expect(promptInput().readOnly).toBe(false)
		expect(host.textContent).toContain(t("agentConfig.cardTitle"))
		expect(host.textContent).toContain(t("agentConfig.subheading"))
		expect(host.textContent).toContain(t("agentConfig.cardDescription"))
		expect(host.textContent).toContain(t("agentConfig.dangerZone"))
		expect(host.textContent).toContain(
			t("agentFields.characterLimit", { used: INITIAL_AGENT.name.length, max: AGENT_NAME_MAX_LENGTH }),
		)
		expect(host.textContent).toContain(
			t("agentFields.characterLimit", { used: INITIAL_AGENT.systemPrompt.length, max: SYSTEM_PROMPT_MAX_LENGTH }),
		)
		expect(nameInput().getAttribute("aria-describedby")).toBe("config-name-limit")
		expect(promptInput().getAttribute("aria-describedby")).toBe("config-system-prompt-limit")

		await typeInto(nameInput(), "Draft")
		expect(host.textContent).toContain(t("agentFields.characterLimit", { used: 5, max: AGENT_NAME_MAX_LENGTH }))

		await typeInto(nameInput(), "")
		await click(button(t("agentConfig.save")))
		expect(nameInput().getAttribute("aria-describedby")).toBe("config-name-limit config-name-error")
		expect(promptInput().getAttribute("aria-describedby")).toBe("config-system-prompt-limit")
	})

	test("never submits a save for a read-only operator", async () => {
		agentPermissions = ["agents:read"]
		await renderPage()
		const form = nameInput().form
		if (!form) throw new Error("Configuration form not rendered")

		await act(async () => form.requestSubmit())
		await settle()

		expect(requests.filter(({ method }) => method === "PUT")).toHaveLength(0)
	})

	test("reports forbidden and missing agents when save is rejected", async () => {
		updateFailures = [
			json({ code: "permission-denied", type: "https://docs.talqo.chat/problems#permission-denied" }, 403),
			json({ code: "agent-not-found", type: "https://docs.talqo.chat/problems#agent-not-found" }, 404),
		]
		await renderPage()
		await typeInto(nameInput(), "Draft agent")

		await click(button(t("agentConfig.save")))
		expect(host.querySelector("form [role='alert']")?.textContent).toBe(t("agents.manageForbidden"))

		await click(button(t("agentConfig.save")))
		expect(host.querySelector("form [role='alert']")?.textContent).toBe(t("agentConfig.wasDeleted"))
		expect(nameInput().value).toBe("Draft agent")
	})
})

describe("agent loading failures", () => {
	test("retries a failed agent load", async () => {
		agentDetailFailures = [json({}, 403)]
		await renderPage()
		expect(host.querySelector("[role='alert']")).not.toBeNull()
		const beforeRetry = requests.filter(
			({ url, method }) => url === `/api/agents/${AGENT_ID}` && method === "GET",
		).length
		const listRequests = requests.filter(({ url }) => url === "/api/agents").length

		await click(button(t("common.retry")))

		expect(requests.filter(({ url, method }) => url === `/api/agents/${AGENT_ID}` && method === "GET")).toHaveLength(
			beforeRetry + 1,
		)
		expect(requests.filter(({ url }) => url === "/api/agents")).toHaveLength(listRequests)
		expect(nameInput().value).toBe(INITIAL_AGENT.name)
	})

	test("explains a missing agent payload", async () => {
		agentDetailMissing = true
		await renderPage()

		expect(host.textContent).toContain(t("agents.loadFailed"))
		expect(host.querySelector("#config-name")).toBeNull()
	})

	test("announces loading while the agent request is in flight", async () => {
		const pending = Promise.withResolvers<Response>()
		agentDetailResponse = pending.promise
		await renderPage()
		expect(host.textContent).toContain(t("agentConfig.loading"))
		expect(host.querySelector("#config-name")).toBeNull()

		await act(async () => pending.resolve(json({ agent })))
		await settle()
		await settle()

		expect(nameInput().value).toBe(INITIAL_AGENT.name)
	})

	test("retries a failed permission list load", async () => {
		agentListFailures = [json({}, 403)]
		await renderPage()
		expect(host.querySelector("[role='alert']")).not.toBeNull()
		const beforeRetry = requestCount(requests, "/api/agents")

		await click(button(t("common.retry")))

		expect(requestCount(requests, "/api/agents")).toBe(beforeRetry + 1)
		expect(requests.filter(({ url, method }) => url === `/api/agents/${AGENT_ID}` && method === "GET")).toHaveLength(1)
		expect(nameInput().value).toBe(INITIAL_AGENT.name)
	})
})

describe("agent tabs", () => {
	test("keeps the selected tab in the URL and renders the tab content", async () => {
		await renderPage()
		expect(button(t("agentConfig.tabConfiguration")).getAttribute("aria-selected")).toBe("true")
		using navigate = spyOn(router, "navigate")

		await click(button(t("agentConfig.tabContext")))

		expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ replace: true, resetScroll: false }))
		const updateSearch = navigate.mock.calls.at(-1)?.[0]?.search
		expect(typeof updateSearch).toBe("function")
		expect(router.state.location.search).toEqual({ tab: "context" })
		expect(button(t("agentConfig.tabContext")).getAttribute("aria-selected")).toBe("true")
		expect(host.textContent).toContain(t("agentFiles.cardTitle"))
		expect(requests.some(({ url }) => url === `/api/agents/${AGENT_ID}/files`)).toBe(true)
	})

	test("renders every tab label and switches panels through the URL", async () => {
		await renderPage()
		for (const label of [
			t("agentConfig.tabConfiguration"),
			t("agentConfig.tabContext"),
			t("agentConfig.tabEmbeds"),
			t("agentConfig.tabMcp"),
		]) {
			expect(button(label)).toBeDefined()
		}

		await click(button(t("agentConfig.tabMcp")))
		expect(router.state.location.search).toEqual({ tab: "mcp" })
		expect(button(t("agentConfig.tabMcp")).getAttribute("aria-selected")).toBe("true")
		expect(host.textContent).toContain(t("mcp.panelDescription"))

		await click(button(t("agentConfig.tabEmbeds")))
		expect(router.state.location.search).toEqual({ tab: "embeds" })
		expect(host.textContent).toContain(t("embedSetup.agentPanelDescription"))
	})
})

describe("agent embeds panel", () => {
	const EMBEDS_ENTRY = `/dashboard/agent/${AGENT_ID}?tab=embeds`

	test("creates a uniquely named embed with defaults and opens it", async () => {
		embeds = [{ ...EMBED, name: t("embedSetup.defaultName") }]
		await renderPage(EMBEDS_ENTRY)

		await click(button(t("embedSetup.createEmbed")))

		expect(createdBodies).toEqual([
			{
				name: `${t("embedSetup.defaultName")} 2`,
				agentId: AGENT_ID,
				appearance: EMBED_FORM_DEFAULTS,
			},
		])
		expect(router.state.location.pathname).toBe("/dashboard/embeds/created-embed")
		expect(host.querySelector('[data-testid="embed-destination"]')).not.toBeNull()
	})

	test("keeps the create error visible and retries the same creation", async () => {
		createFailures = [json({}, 500)]
		await renderPage(EMBEDS_ENTRY)

		await click(button(t("embedSetup.createEmbed")))
		expect(host.querySelector("[role='alert']")?.textContent).toContain(t("embedSetup.createError"))
		expect(createdBodies).toHaveLength(1)

		await click(button(t("common.retry")))
		expect(createdBodies).toHaveLength(2)
		expect(createdBodies[1]).toEqual(createdBodies[0])
		expect(router.state.location.pathname).toBe("/dashboard/embeds/created-embed")
	})

	test("retries a failed embed list without dropping the agent filter", async () => {
		embedListFailing = true
		await renderPage(EMBEDS_ENTRY)
		expect(host.querySelector("[role='alert']")?.textContent).toContain(t("embedSetup.loadError"))
		const beforeRetry = embedRequestCount()

		embedListFailing = false
		await click(button(t("common.retry")))

		expect(embedRequestCount()).toBe(beforeRetry + 1)
		expect(host.textContent).toContain(t("embedSetup.emptyTitle"))
		expect(
			requests
				.filter(({ url }) => url.startsWith("/api/embeds?"))
				.every(({ url }) => url.endsWith(`agentId=${AGENT_ID}`)),
		).toBe(true)
	})

	test("shows readers an empty state without creation controls", async () => {
		agentPermissions = ["agents:read"]
		await renderPage(EMBEDS_ENTRY)
		await settle()
		await settle()

		expect(host.textContent).toContain(t("embedSetup.emptyDescriptionReader"))
		expect(
			[...host.querySelectorAll("button")].some(
				(element) => element.textContent?.trim() === t("embedSetup.createEmbed"),
			),
		).toBe(false)
	})

	test("disables the embed switch for readers", async () => {
		agentPermissions = ["agents:read"]
		embeds = [EMBED]
		await renderPage(EMBEDS_ENTRY)
		await settle()
		await settle()

		expect(host.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled).toBe(true)
	})

	test("announces loading while the agent's embeds load", async () => {
		const pending = Promise.withResolvers<Response>()
		embedsResponse = pending.promise
		await renderPage(EMBEDS_ENTRY)
		expect(host.querySelector("output")?.textContent).toBe(t("embedSetup.loading"))

		await act(async () => pending.resolve(json({ embeds: [] })))
		await settle()
		await settle()

		expect(host.textContent).toContain(t("embedSetup.emptyTitle"))
	})

	test("creates an embed while the agent's embed list is still loading", async () => {
		const pending = Promise.withResolvers<Response>()
		embedsResponse = pending.promise
		await renderPage(EMBEDS_ENTRY)

		await click(button(t("embedSetup.createEmbed")))

		expect(createdBodies).toEqual([
			{ name: t("embedSetup.defaultName"), agentId: AGENT_ID, appearance: EMBED_FORM_DEFAULTS },
		])
		expect(router.state.location.pathname).toBe("/dashboard/embeds/created-embed")

		await act(async () => pending.resolve(json({ embeds: [] })))
	})

	for (const { from, seeded } of [
		{ from: "the empty state", seeded: [] as Array<typeof EMBED> },
		{ from: "the panel header", seeded: [EMBED] },
	]) {
		test(`announces embed creation from ${from} and opens the new embed`, async () => {
			embeds = seeded
			const pending = Promise.withResolvers<Response>()
			createFailures = [pending.promise]
			await renderPage(EMBEDS_ENTRY)
			if (seeded.length === 0) expect(host.textContent).toContain(t("embedSetup.emptyDescriptionManager"))

			await click(button(t("embedSetup.createEmbed")))
			expect(button(t("embedSetup.creating")).disabled).toBe(true)
			expect(createdBodies).toHaveLength(1)

			const created = { ...EMBED, id: "created-embed", name: String(createdBodies[0]?.name) }
			await act(async () => pending.resolve(json({ embed: created }, 201)))
			await settle()
			await settle()

			expect(router.state.location.pathname).toBe("/dashboard/embeds/created-embed")
		})
	}

	test("shows each embed's name, language and detail link", async () => {
		embeds = [{ ...EMBED, appearance: { ...EMBED_FORM_DEFAULTS, language: "cs" } }]
		await renderPage(EMBEDS_ENTRY)

		expect(host.textContent).toContain(EMBED.name)
		expect(host.textContent).toContain("Čeština")
		const link = host.querySelector(`a[aria-label="${EMBED.name}"]`)
		if (!link) throw new Error("Embed card link not rendered")
		expect(link.getAttribute("href")?.startsWith(`/dashboard/embeds/${EMBED.id}`)).toBe(true)
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

	test("enables deletion when the agent has no embeds", async () => {
		await renderPage()

		expect(button(t("agentConfig.deleteAgent")).disabled).toBe(false)
		expect(host.textContent).not.toContain(t("agentConfig.deleteBlockedByEmbeds", { count: 0 }))
	})

	test("points a blocked deletion at the agent's embeds tab", async () => {
		embeds = [EMBED]
		await renderPage()

		expect(host.textContent).toContain(t("agentConfig.dangerZone"))
		expect(host.textContent).toContain(t("agentConfig.dangerDescription"))
		expect(host.textContent).toContain(t("agentConfig.deleteBlockedByEmbeds", { count: 1 }))
		expect(button(t("agentConfig.deleteAgent")).disabled).toBe(true)
		const dangerZone = host.querySelector("section[aria-labelledby]")
		if (!dangerZone) throw new Error("Danger zone not rendered")
		const paragraphs = [...dangerZone.querySelectorAll("p")].map((paragraph) => paragraph.textContent)
		expect(paragraphs).toContain(t("agentConfig.deleteAgent"))
		expect(paragraphs).toContain(
			`${t("agentConfig.deleteBlockedByEmbeds", { count: 1 })} ${t("agentConfig.manageEmbeds")}`,
		)
		const link = [...host.querySelectorAll("a")].find(
			(anchor) => anchor.textContent?.trim() === t("agentConfig.manageEmbeds"),
		)
		if (!link) throw new Error("Manage embeds link not rendered")
		expect(link.getAttribute("href")).toBe(`/dashboard/agent/${AGENT_ID}?tab=embeds`)
	})

	test("names the agent in the delete confirmation and holds it open while deleting", async () => {
		const pending = Promise.withResolvers<Response>()
		deleteFailures = [pending.promise]
		await renderPage()
		await click(button(t("agentConfig.deleteAgent")))

		expect(deleteDialog().textContent).toContain(t("agentConfig.deleteTitle"))
		expect(deleteDialog().textContent).toContain(t("agentConfig.deletePrompt", { name: INITIAL_AGENT.name }))
		expect(deleteDialog().textContent).toContain(t("agentConfig.confirmLabel", { name: INITIAL_AGENT.name }))
		expect(button(t("agentConfig.deleteConfirm"), deleteDialog()).disabled).toBe(true)

		await typeDeleteConfirmation()
		const confirm = button(t("agentConfig.deleteConfirm"), deleteDialog())
		expect(confirm.disabled).toBe(false)

		await click(confirm)
		expect(deleteDialog().textContent).toContain(t("agentConfig.deleting"))
		expect(button(t("agentConfig.deleting"), deleteDialog()).disabled).toBe(true)

		await act(async () => pending.resolve(new Response(null, { status: 204 })))
		await settle()
		await settle()

		expect(router.state.location.pathname).toBe("/dashboard/agents")
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
	})

	test("explains a deletion rejected because the agent is already gone", async () => {
		deleteFailures = [json({ code: "agent-not-found", type: "https://docs.talqo.chat/problems#agent-not-found" }, 404)]
		await renderPage()
		await click(button(t("agentConfig.deleteAgent")))
		await click(button(t("agentConfig.cancel"), deleteDialog()))
		expect(document.querySelector("[role='alertdialog']")).toBeNull()

		await click(button(t("agentConfig.deleteAgent")))
		await typeDeleteConfirmation()

		await click(button(t("agentConfig.deleteConfirm"), deleteDialog()))

		expect(deleteDialog().textContent).toContain(t("agentConfig.wasDeleted"))
		expect(router.state.location.pathname).toBe(`/dashboard/agent/${AGENT_ID}`)
	})

	test("clears the previous deletion error while retrying without closing the dialog", async () => {
		const pending = Promise.withResolvers<Response>()
		deleteFailures = [json({}, 500), pending.promise]
		await renderPage()
		await click(button(t("agentConfig.deleteAgent")))
		await typeDeleteConfirmation()

		await click(button(t("agentConfig.deleteConfirm"), deleteDialog()))
		expect(deleteDialog().textContent).toContain(t("agents.deleteFailed"))

		await click(button(t("agentConfig.deleteConfirm"), deleteDialog()))
		expect(deleteDialog().textContent).not.toContain(t("agents.deleteFailed"))
		expect(deleteDialog().textContent).toContain(t("agentConfig.deleting"))

		await act(async () => pending.resolve(new Response(null, { status: 204 })))
		await settle()
		await settle()

		expect(router.state.location.pathname).toBe("/dashboard/agents")
	})

	test("keeps a failed deletion open, refreshes embeds, then bypasses the dirty guard on success", async () => {
		deleteFailures = [json({}, 500)]
		await renderPage()
		await typeInto(nameInput(), "Unsaved agent name")
		await click(button(t("agentConfig.deleteAgent")))
		await typeDeleteConfirmation()
		const embedsBeforeDelete = embedRequestCount()

		await click(button(t("agentConfig.deleteConfirm"), deleteDialog()))
		expect(deleteDialog().textContent).toContain(t("agents.deleteFailed"))
		expect(embedRequestCount()).toBe(embedsBeforeDelete + 1)
		expect(nameInput().value).toBe("Unsaved agent name")
		expect(router.state.location.pathname).toBe(`/dashboard/agent/${AGENT_ID}`)

		await click(button(t("agentConfig.cancel"), deleteDialog()))
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		await click(button(t("agentConfig.deleteAgent")))
		expect(deleteDialog().textContent).not.toContain(t("agents.deleteFailed"))
		await typeDeleteConfirmation()

		await click(button(t("agentConfig.deleteConfirm"), deleteDialog()))
		expect(router.state.location.pathname).toBe("/dashboard/agents")
		expect(host.querySelector("h1")?.textContent).toBe(t("agents.heading"))
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
	})
})
