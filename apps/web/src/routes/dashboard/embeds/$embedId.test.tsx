import type { Embed } from "@/api/generated/models/embed.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { Route } = await import("./$embedId")
const { getGetEmbedQueryKey, getListEmbedsQueryKey } = await import("@/api/generated/embed/embed.ts")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

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
const SAVED_EMBED: Embed = {
	...INITIAL_EMBED,
	name: "Saved by server",
	appearance: {
		...INITIAL_EMBED.appearance,
		light: { ...INITIAL_EMBED.appearance.light, primary: "#abcdef" },
	},
}

let currentEmbed: Embed
let updateFailures: Response[]
let deleteFailures: Response[]
let updates: unknown[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function respond(request: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url
	const method = init?.method ?? "GET"

	if (url === "/api/agents" && method === "GET") {
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
					permissions: ["agents:read", "agents:manage"],
				},
			],
		})
	}
	if (url === DETAIL_URL && method === "GET") return json({ embed: currentEmbed })
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

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
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
		component: () => <h1>Agent destination</h1>,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([detail, agent]),
		history: createMemoryHistory({ initialEntries: [`/dashboard/embeds/${EMBED_ID}`] }),
	})
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
	return router
}

function input(selector: string): HTMLInputElement {
	const found = host.querySelector<HTMLInputElement>(selector)
	if (!found) throw new Error(`Input ${selector} not rendered`)
	return found
}

function button(label: string, scope: ParentNode = host): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
	if (!found) throw new Error(`Button "${label}" not rendered`)
	return found
}

function formStatus(): string | undefined {
	return input("#widget-name").form?.querySelector("output")?.textContent ?? undefined
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
	updateFailures = []
	deleteFailures = []
	updates = []
	spyOn(globalThis, "fetch").mockImplementation(respond as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
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

describe("embed deletion", () => {
	test("keeps failure state intact, then clears cached queries and bypasses the dirty guard", async () => {
		deleteFailures = [json({}, 500)]
		const router = await renderPage()
		const listKey = getListEmbedsQueryKey()
		const detailKey = getGetEmbedQueryKey(EMBED_ID)
		queryClient.setQueryData(listKey, { data: { embeds: [INITIAL_EMBED] } })
		await typeInto(input("#widget-name"), "Unsaved embed name")
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
		expect(host.querySelector("h1")?.textContent).toBe("Agent destination")
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		expect(queryClient.getQueryData(listKey)).toBeUndefined()
		expect(queryClient.getQueryData(detailKey)).toBeUndefined()
	})
})
