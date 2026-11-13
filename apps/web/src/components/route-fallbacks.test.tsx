import type { Root } from "react-dom/client"

import { act, createTestHarness } from "@/testing/component-harness"
import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"

const { NotFoundFallback, RouteErrorFallback } = await import("./route-fallbacks")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { t } = await import("i18next")

let host: HTMLDivElement
let root: Root
let harness: ReturnType<typeof createTestHarness>

async function renderFallback(Fallback: typeof NotFoundFallback) {
	const rootRoute = createRootRoute()
	const page = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Fallback })
	const dashboard = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: () => null })
	const router = createRouter({
		routeTree: rootRoute.addChildren([page, dashboard]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	})
	await act(async () => {
		await router.load()
		root.render(<RouterProvider router={router} />)
	})
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function dashboardLink(): HTMLAnchorElement {
	const link = host.querySelector<HTMLAnchorElement>('a[href="/dashboard"]')
	if (!link) throw new Error("Missing dashboard link")
	return link
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
	if (!found) throw new Error(`Missing button: ${label}`)
	return found
}

beforeEach(() => {
	harness = createTestHarness()
	;({ host, root } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

test("explains a missing page and links back to the dashboard", async () => {
	await renderFallback(NotFoundFallback)

	expect(host.textContent).toContain(t("fallback.notFoundTitle"))
	expect(host.textContent).toContain(t("fallback.notFoundDescription"))
	expect(dashboardLink().textContent?.trim()).toBe(t("fallback.backToDashboard"))
})

test("offers a reload and a way back after a route error", async () => {
	await renderFallback(RouteErrorFallback)
	const reload = spyOn(window.location, "reload").mockImplementation(() => {})

	expect(host.textContent).toContain(t("fallback.errorTitle"))
	expect(host.textContent).toContain(t("fallback.errorDescription"))
	expect(dashboardLink().textContent?.trim()).toBe(t("fallback.backToDashboard"))

	await act(async () => button(t("common.retry")).click())
	expect(reload).toHaveBeenCalledTimes(1)
})
