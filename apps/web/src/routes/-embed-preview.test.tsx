import type { Embed } from "@/api/generated/models/embed.zod"

import { json } from "@/testing/api-responses"
import { act, createTestHarness, type QueryClient, type Root, settle } from "@/testing/component-harness"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, expect, test } from "bun:test"

const { Route } = await import("./embed-preview")
const { EMBED_FORM_DEFAULTS } = await import("@/features/embeds/embed-appearance-form")
const { createMemoryHistory, createRootRoute, createRoute, createRouter } = await import("@tanstack/react-router")
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

let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let embedResponse: Response | Promise<Response> | undefined
let requests: string[]

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
	await renderRouter(root, queryClient, router)
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
	harness = createTestHarness({
		fetch: (async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			requests.push(url)
			if (url === `/api/embeds/${EMBED.id}`) return embedResponse ?? json({ embed: EMBED })
			throw new Error(`Unexpected request ${url}`)
		}) as typeof fetch,
	})
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
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

	expect(host.querySelector("output")).toBeNull()
	const frame = host.querySelector("iframe")
	if (!(frame instanceof HTMLIFrameElement)) throw new Error("Missing preview frame")
	expect(frame.src).toContain(`title=${EMBED.name}`)
})
