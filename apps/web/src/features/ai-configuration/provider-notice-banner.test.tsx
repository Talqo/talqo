import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { ProviderNoticeBanner } = await import("./provider-notice-banner")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let permissions: string[]
let configuration: () => Response
let configurationRequests: number

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderBanner() {
	const rootRoute = createRootRoute({ component: () => <ProviderNoticeBanner /> })
	const configurationRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/ai-configuration",
		component: () => null,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([configurationRoute]),
		history: createMemoryHistory(),
	})
	await act(async () =>
		root.render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		),
	)
	await settle()
	await settle()
}

beforeEach(() => {
	permissions = ["ai_provider:manage"]
	configuration = () => json({ revision: 1, health: "unconfigured", text: null, embedding: null })
	configurationRequests = 0
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url === "/api/me/permissions") return json({ permissions })
		if (url === "/api/ai-provider-configuration") {
			configurationRequests += 1
			return configuration()
		}
		throw new Error(`unexpected request ${url}`)
	}) as typeof fetch)
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
})

describe("ProviderNoticeBanner", () => {
	test("prompts provider managers to finish an unconfigured provider", async () => {
		await renderBanner()

		expect(host.querySelector("output")?.textContent).toBe(t("dashboard.aiProviderMissing"))
		const link = host.querySelector<HTMLAnchorElement>("a")
		expect(link?.textContent).toBe(t("dashboard.aiProviderMissingAction"))
		expect(link?.getAttribute("href")).toBe("/dashboard/ai-configuration")
	})

	test("stays hidden once the provider is configured", async () => {
		configuration = () => json({ revision: 1, health: "configured", text: null, embedding: null })
		await renderBanner()

		expect(host.querySelector("output") === null).toBe(true)
		expect(configurationRequests).toBe(1)
	})

	test("reports a failed provider check instead of hiding it", async () => {
		configuration = () => json({ code: "internal-server-error", type: "problem" }, 500)
		await renderBanner()

		expect(host.querySelector("output")?.textContent).toBe(t("dashboard.aiProviderCheckFailed"))
		expect(host.querySelector("a")?.textContent).toBe(t("dashboard.aiProviderCheckFailedAction"))
	})

	test("does not read the configuration for operators who cannot manage it", async () => {
		permissions = []
		await renderBanner()

		expect(host.querySelector("output") === null).toBe(true)
		expect(configurationRequests).toBe(0)
	})
})
