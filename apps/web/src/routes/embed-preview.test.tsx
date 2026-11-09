import type { Embed } from "@/api/generated/models/embed.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { Route } = await import("./embed-preview")
const { EMBED_FORM_DEFAULTS } = await import("@/features/embeds/embed-appearance-form")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const EmbedPreviewPage = Route.options.component ?? (() => null)
const validateSearch = Route.options.validateSearch
if (typeof validateSearch !== "function") throw new Error("Embed preview route has no search validator")

const EMBED: Embed = {
	id: "embed-1",
	agentId: "agent-1",
	name: "Storefront",
	embedToken: "embed-token",
	accessVersion: 1,
	isDisabled: false,
	appearance: EMBED_FORM_DEFAULTS,
}

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let embedResponse: Response | Promise<Response> | undefined
let requests: string[]

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPage(initialEntry: string) {
	const rootRoute = createRootRoute()
	const page = createRoute({
		getParentRoute: () => rootRoute,
		path: "/embed-preview",
		validateSearch,
		component: EmbedPreviewPage,
	})
	const agents = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard/agents", component: () => null })
	const embedDetail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/embeds/$embedId",
		component: () => null,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([page, agents, embedDetail]),
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
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
	return router
}

function backLink(): HTMLAnchorElement {
	const link = host.querySelector<HTMLAnchorElement>("a")
	if (!link) throw new Error("Missing back link")
	return link
}

beforeEach(() => {
	requests = []
	embedResponse = undefined
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		requests.push(url)
		if (url === `/api/embeds/${EMBED.id}`) return embedResponse ?? json({ embed: EMBED })
		throw new Error(`Unexpected request ${url}`)
	}) as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	host = document.createElement("div")
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	queryClient.clear()
	mock.restore()
})

test("accepts only a string embed id from the URL", () => {
	expect(validateSearch({ embed: "embed-1" })).toEqual({ embed: "embed-1" })
	expect(validateSearch({})).toEqual({ embed: "" })
	expect(validateSearch({ embed: 42 })).toEqual({ embed: "" })
})

test("does not request an embed without an id and links back to the agent setup", async () => {
	await renderPage("/embed-preview")

	expect(backLink().getAttribute("href")).toBe("/dashboard/agents")
	expect(backLink().textContent).toContain(t("embedSetup.backToSetup"))
	expect(host.textContent).toContain(t("embedSetup.notFound"))
	expect(requests.filter((url) => url.startsWith("/api/embeds"))).toEqual([])
})

test("shows a loading state and then the saved embed preview", async () => {
	const pending = Promise.withResolvers<Response>()
	embedResponse = pending.promise
	await renderPage(`/embed-preview?embed=${EMBED.id}`)

	expect(host.querySelector("output")?.textContent).toBe(t("embedSetup.loading"))
	expect(backLink().getAttribute("href")).toBe(`/dashboard/embeds/${EMBED.id}`)

	await act(async () => pending.resolve(json({ embed: EMBED })))
	await settle()
	await settle()

	expect(host.querySelector("output") === null).toBe(true)
	const frame = host.querySelector("iframe")
	if (!(frame instanceof HTMLIFrameElement)) throw new Error("Missing preview frame")
	expect(frame.src).toContain(`title=${EMBED.name}`)
})
