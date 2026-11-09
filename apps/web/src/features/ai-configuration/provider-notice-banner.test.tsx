import { json } from "@/testing/api-responses"
import { createTestHarness, type QueryClient, type Root } from "@/testing/component-harness"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { ProviderNoticeBanner } = await import("./provider-notice-banner")
const { createRootRoute, createRoute, createRouter, createMemoryHistory } = await import("@tanstack/react-router")
const { t } = await import("i18next")

let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let permissions: string[]
let configuration: () => Response
let configurationRequests: number

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
	await renderRouter(root, queryClient, router)
}

beforeEach(() => {
	permissions = ["ai_provider:manage"]
	configuration = () => json({ revision: 1, health: "unconfigured", text: null, embedding: null })
	configurationRequests = 0
	harness = createTestHarness({
		fetch: (async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			if (url === "/api/me/permissions") return json({ permissions })
			if (url === "/api/ai-provider-configuration") {
				configurationRequests += 1
				return configuration()
			}
			throw new Error(`unexpected request ${url}`)
		}) as typeof fetch,
	})
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
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
