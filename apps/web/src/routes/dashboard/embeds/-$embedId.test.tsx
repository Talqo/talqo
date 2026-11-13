import type { Embed } from "@/api/generated/models/embed.zod"

import { json, requestCount } from "@/testing/api-responses"
import { act, createTestHarness, type QueryClient, type Root, settle } from "@/testing/component-harness"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { Route } = await import("./$embedId")
const { getGetEmbedQueryKey, getListEmbedsQueryKey } = await import("@/api/generated/embed/embed.ts")
const { createMemoryHistory, createRootRoute, createRoute, createRouter } = await import("@tanstack/react-router")
const { t } = await import("i18next")
const { supportedLanguages } = await import("@talqo/shared/languages")

const EmbedDetailPage = Route.options.component ?? (() => null)

const EMBED_ID = "embed-1"
const AGENT_ID = "original-agent"
const DETAIL_URL = `/api/embeds/${EMBED_ID}`
const INITIAL_EMBED: Embed = {
	id: EMBED_ID,
	agentId: AGENT_ID,
	name: "Storefront",
	embedToken: "initial-token",
	accessVersion: 1,
	isDisabled: false,
	appearance: {
		light: {
			primary: "#1a7f4b",
			textOnPrimary: "#ffffff",
			background: "#ffffff",
			surface: "#f5f5f5",
			text: "#171717",
		},
		dark: {
			primary: "#34d399",
			textOnPrimary: "#052e16",
			background: "#0a0a0a",
			surface: "#1a1a1a",
			text: "#fafafa",
		},
		position: "bottom-right",
		theme: "system",
		themeToggle: false,
		language: "en",
	},
}
const DEFAULT_AGENT_PERMISSIONS = ["agents:read", "agents:manage"]
const SAVED_EMBED: Embed = {
	...INITIAL_EMBED,
	name: "Saved by server",
	appearance: {
		...INITIAL_EMBED.appearance,
		light: { ...INITIAL_EMBED.appearance.light, primary: "#abcdef" },
	},
}

let currentEmbed: Embed
let agentPermissions: string[]
let detailFailures: Response[]
let agentsFailures: Response[]
let updateFailures: Response[]
let deleteFailures: Response[]
let updates: unknown[]
let requests: Array<{ url: string; method: string }>
let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

async function respond(request: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url
	const method = init?.method ?? "GET"
	requests.push({ url, method })

	if (url === "/api/agents" && method === "GET") {
		const failure = agentsFailures.shift()
		if (failure) return failure
		return json({
			agents: [
				{
					id: "read-only-agent",
					name: "Read-only agent",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					permissions: ["agents:read"],
				},
				{
					id: AGENT_ID,
					name: "Support agent",
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					permissions: agentPermissions,
				},
			],
		})
	}
	if (url === DETAIL_URL && method === "GET") {
		const failure = detailFailures.shift()
		if (failure) return failure
		return json({ embed: currentEmbed })
	}
	if (url === DETAIL_URL && method === "DELETE") {
		return deleteFailures.shift() ?? new Response(null, { status: 204 })
	}
	if (url === DETAIL_URL && method === "PUT") {
		const body = init?.body
		if (typeof body !== "string") throw new Error("Embed update must have a JSON body")
		updates.push(JSON.parse(body))
		const failure = updateFailures.shift()
		if (failure) return failure
		currentEmbed = SAVED_EMBED
		return json({ embed: SAVED_EMBED })
	}
	throw new Error(`Unexpected request ${method} ${url}`)
}

async function renderPage() {
	const rootRoute = createRootRoute()
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/embeds/$embedId",
		validateSearch: Route.options.validateSearch,
		component: EmbedDetailPage,
	})
	const agent = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/agent/$agentId",
		component: () => <div data-testid="agent-destination" />,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([detail, agent]),
		history: createMemoryHistory({ initialEntries: [`/dashboard/embeds/${EMBED_ID}`] }),
	})
	await renderRouter(root, queryClient, router)
	return router
}

function input(selector: string): HTMLInputElement {
	const found = host.querySelector<HTMLInputElement>(selector)
	if (!found) throw new Error(`Input ${selector} not rendered`)
	return found
}

function button(label: string, scope: ParentNode = host): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find(
		(element) => element.textContent?.trim() === label || element.getAttribute("aria-label") === label,
	)
	if (!found) throw new Error(`Button "${label}" not rendered`)
	return found
}

function formStatus(): string | undefined {
	return input("#widget-name").form?.querySelector("output")?.textContent ?? undefined
}

async function choose(triggerSelector: string, label: string) {
	const trigger = host.querySelector<HTMLElement>(triggerSelector)
	if (!trigger) throw new Error(`Select ${triggerSelector} not rendered`)
	await click(trigger)
	const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
		(candidate) => candidate.textContent?.trim() === label,
	)
	if (!option) throw new Error(`Option "${label}" not rendered`)
	await click(option)
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

async function submit(formButton: HTMLButtonElement) {
	await act(async () => formButton.form?.requestSubmit(formButton))
	await settle()
	await settle()
}

async function typeInto(element: HTMLInputElement, value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
	await settle()
}

beforeEach(() => {
	currentEmbed = INITIAL_EMBED
	agentPermissions = [...DEFAULT_AGENT_PERMISSIONS]
	detailFailures = []
	agentsFailures = []
	updateFailures = []
	deleteFailures = []
	updates = []
	requests = []
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
})

describe("embed appearance saving", () => {
	test("keeps a failed draft dirty and saves with the original agent before resetting from the response", async () => {
		updateFailures = [json({}, 500)]
		await renderPage()
		expect(formStatus()).toBeUndefined()
		await typeInto(input("#widget-name"), "  Draft name  ")
		await typeInto(input("#color-light-primary-hex"), "#246810")

		await submit(button(t("embedSetup.save")))

		expect(host.querySelector("form [role='alert']")?.textContent).toBe(t("embedSetup.saveError"))
		expect(input("#widget-name").value).toBe("  Draft name  ")
		expect(input("#color-light-primary-hex").value).toBe("#246810")
		expect(button(t("embedSetup.save")).disabled).toBe(false)
		expect(formStatus()).toBeUndefined()

		await submit(button(t("embedSetup.save")))
		await settle()
		await settle()

		expect(updates).toHaveLength(2)
		expect(updates[1]).toEqual({
			name: "Draft name",
			agentId: AGENT_ID,
			appearance: {
				light: {
					primary: "#246810",
					textOnPrimary: "#ffffff",
					background: "#ffffff",
					surface: "#f5f5f5",
					text: "#171717",
				},
				dark: {
					primary: "#34d399",
					textOnPrimary: "#052e16",
					background: "#0a0a0a",
					surface: "#1a1a1a",
					text: "#fafafa",
				},
				position: "bottom-right",
				theme: "system",
				themeToggle: false,
				language: "en",
			},
		})
		expect(input("#widget-name").value).toBe("Saved by server")
		expect(input("#color-light-primary-hex").value).toBe("#abcdef")
		expect(button(t("embedSetup.save")).disabled).toBe(true)
		expect(formStatus()).toBe(t("embedSetup.saved"))

		await typeInto(input("#widget-name"), "Another draft")
		expect(formStatus()).toBeUndefined()
		expect(button(t("embedSetup.save")).disabled).toBe(false)
	})
})

describe("embed detail loading", () => {
	test("explains a missing embed without offering a retry", async () => {
		detailFailures = [json({ code: "embed-not-found", type: "https://docs.talqo.chat/problems#embed-not-found" }, 404)]
		await renderPage()

		expect(host.textContent).toContain(t("embedSetup.notFound"))
		expect(host.querySelector("[role='alert']") === null).toBe(true)
	})

	test("retries a failed embed load and then renders the form", async () => {
		detailFailures = [json({}, 403)]
		await renderPage()
		expect(host.textContent).toContain(t("embedSetup.detailLoadError"))
		const beforeRetry = requests.filter(({ url, method }) => url === DETAIL_URL && method === "GET").length

		await click(button(t("common.retry")))

		expect(requests.filter(({ url, method }) => url === DETAIL_URL && method === "GET")).toHaveLength(beforeRetry + 1)
		expect(input("#widget-name").value).toBe(INITIAL_EMBED.name)
	})

	test("retries a failed agent permission load before allowing edits", async () => {
		agentsFailures = [json({}, 403)]
		await renderPage()
		expect(host.querySelector("[role='alert']")?.textContent).toContain(t("common.retry"))
		expect(host.querySelector("#widget-name") === null).toBe(true)
		const beforeRetry = requestCount(requests, "/api/agents")

		await click(button(t("common.retry")))

		expect(requestCount(requests, "/api/agents")).toBe(beforeRetry + 1)
		expect(input("#widget-name").value).toBe(INITIAL_EMBED.name)
	})

	test("explains when the embed is disabled", async () => {
		currentEmbed = { ...INITIAL_EMBED, isDisabled: true }
		await renderPage()

		expect(host.textContent).toContain(t("embedSetup.embedDisabledNote"))
	})

	test("makes the form and token read-only without manage permission", async () => {
		agentPermissions = ["agents:read"]
		await renderPage()

		expect(input("#widget-name").readOnly).toBe(true)
		expect(input("#color-light-primary-hex").readOnly).toBe(true)
		expect(host.querySelector("#widget-position")?.getAttribute("disabled")).not.toBeNull()
		expect(host.querySelector("#embed-token") === null).toBe(true)
		expect(host.textContent).not.toContain(t("embedSetup.deleteEmbed"))
		expect(
			[...host.querySelectorAll("button")].some((element) => element.textContent?.trim() === t("embedSetup.save")),
		).toBe(false)
	})
})

describe("embed snippet copying", () => {
	test("writes the current snippet and recovers after a rejected clipboard write", async () => {
		const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")
		const writes: string[] = []
		let reject = true
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: async (text: string) => {
					writes.push(text)
					if (reject) throw new Error("clipboard denied")
				},
			},
		})
		try {
			await renderPage()
			const copy = t("embedSetup.copyEmbed")

			await click(button(copy))
			expect(writes).toHaveLength(1)

			reject = false
			await click(button(copy))
			expect(writes).toHaveLength(2)
			expect(writes[1]).toContain(`data-talqo-embed-token="${INITIAL_EMBED.embedToken}"`)
			expect(writes[1]).toContain(`${window.location.origin}/widget.js`)
		} finally {
			if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard)
			else Reflect.deleteProperty(navigator, "clipboard")
		}
	})
})

describe("embed appearance controls", () => {
	test("keeps the selected color scheme in the URL", async () => {
		const router = await renderPage()
		expect(button(t("embedSetup.tabLight")).getAttribute("aria-selected")).toBe("true")

		await click(button(t("embedSetup.tabDark")))

		expect(router.state.location.search).toEqual({ colorTab: "dark" })
		expect(button(t("embedSetup.tabDark")).getAttribute("aria-selected")).toBe("true")
		expect(host.querySelector("#color-dark-primary-hex") === null).toBe(false)
	})

	test("saves the selected position, theme, language, and theme toggle", async () => {
		await renderPage()
		expect(host.querySelector("#widget-position")?.textContent).toContain(t("embedSetup.positionBottomRight"))
		expect(host.querySelector("#widget-theme")?.textContent).toContain(t("embedSetup.themeSystem"))
		expect(host.querySelector("#widget-language")?.textContent).toContain(supportedLanguages.en)
		await typeInto(input("#widget-name"), "Storefront")
		await choose("#widget-position", t("embedSetup.positionBottomLeft"))
		await choose("#widget-theme", t("embedSetup.themeDark"))
		await choose("#widget-language", supportedLanguages.cs)
		const themeToggle = host.querySelector<HTMLElement>("[role='switch']")
		if (!themeToggle) throw new Error("Theme toggle not rendered")
		await click(themeToggle)

		await submit(button(t("embedSetup.save")))

		expect(updates).toHaveLength(1)
		expect(updates[0]).toEqual({
			name: "Storefront",
			agentId: AGENT_ID,
			appearance: {
				...INITIAL_EMBED.appearance,
				position: "bottom-left",
				theme: "dark",
				themeToggle: true,
				language: "cs",
			},
		})
	})
})

describe("embed deletion", () => {
	test("keeps failure state intact, then clears cached queries and bypasses the dirty guard", async () => {
		deleteFailures = [json({}, 500)]
		const router = await renderPage()
		const listKey = getListEmbedsQueryKey()
		const detailKey = getGetEmbedQueryKey(EMBED_ID)
		queryClient.setQueryData(listKey, { data: { embeds: [INITIAL_EMBED] } })
		await typeInto(input("#widget-name"), "Unsaved embed name")
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		await click(button(t("embedSetup.deleteEmbed")))
		await click(button(t("embedSetup.cancel"), deleteDialog()))
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		await click(button(t("embedSetup.deleteEmbed")))
		const confirmation = deleteDialog().querySelector("input")
		if (!(confirmation instanceof HTMLInputElement)) throw new Error("Delete confirmation field not rendered")
		await typeInto(confirmation, INITIAL_EMBED.name)

		await click(button(t("embedSetup.deleteConfirm"), deleteDialog()))

		expect(deleteDialog().querySelector("[role='alert']")?.textContent).toBe(t("embedSetup.deleteFailed"))
		expect(input("#widget-name").value).toBe("Unsaved embed name")
		expect(router.state.location.pathname).toBe(`/dashboard/embeds/${EMBED_ID}`)
		expect(queryClient.getQueryData(listKey)).toEqual({ data: { embeds: [INITIAL_EMBED] } })
		expect(queryClient.getQueryData(detailKey)).toMatchObject({ data: { embed: INITIAL_EMBED } })

		await click(button(t("embedSetup.deleteConfirm"), deleteDialog()))

		expect(router.state.location.pathname).toBe(`/dashboard/agent/${AGENT_ID}`)
		expect(router.state.location.search).toHaveProperty("tab", "embeds")
		expect(host.querySelector('[data-testid="agent-destination"]')).not.toBeNull()
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		expect(queryClient.getQueryData(listKey)).toBeUndefined()
		expect(queryClient.getQueryData(detailKey)).toBeUndefined()
	})
})
