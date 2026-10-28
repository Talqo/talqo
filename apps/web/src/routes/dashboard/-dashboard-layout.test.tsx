import type { Permission } from "@/features/permissions/require-permission"
import type { ReactNode } from "react"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { DashboardLayout } = await import("./-dashboard-layout")
const { AgentAccessCard } = await import("@/features/agents/agent-access-card")
const { requirePermission } = await import("@/features/permissions/require-permission")
const { LanguageProvider } = await import("@/lib/use-language")
const { ThemeProvider } = await import("@/lib/use-theme")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider, Outlet } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

let root: Root | undefined
let host: HTMLDivElement | undefined
let client: InstanceType<typeof QueryClient> | undefined

afterEach(async () => {
	await act(async () => root?.unmount())
	host?.remove()
	client?.clear()
	mock.restore()
})

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPage(content: ReactNode, permission?: Permission) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	client = queryClient
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	const route = createRootRoute({
		component: () => (
			<LanguageProvider>
				<ThemeProvider>
					<DashboardLayout>
						<Outlet />
					</DashboardLayout>
				</ThemeProvider>
			</LanguageProvider>
		),
	})
	const page = createRoute({
		getParentRoute: () => route,
		path: "/",
		beforeLoad: permission ? requirePermission(permission) : undefined,
		component: () => content,
	})
	const account = createRoute({
		getParentRoute: () => route,
		path: "/dashboard/account",
		component: () => <h1>{t("account.heading")}</h1>,
	})
	const users = createRoute({
		getParentRoute: () => route,
		path: "/dashboard/users",
		component: () => <h1>{t("nav.users")}</h1>,
	})
	const router = createRouter({ routeTree: route.addChildren([page, account, users]), history: createMemoryHistory() })
	await act(async () =>
		root?.render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		),
	)
	await settle()
	await settle()
	return { host, queryClient, router }
}

test("keeps global navigation and the current page when agent discovery fails", async () => {
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url.endsWith("/api/agents")) return new Response(null, { status: 503 })
		return json(
			url.endsWith("/api/me/permissions")
				? { permissions: ["admin", "users:read", "ai_provider:manage"] }
				: { user: { username: "Admin" } },
		)
	}) as typeof fetch)
	const rendered = await renderPage(<h1>{t("account.heading")}</h1>)
	const links = [...rendered.host.querySelectorAll("nav a")].map((link) => link.textContent)
	expect(links).toContain(t("nav.users"))
	expect(links).toContain(t("nav.aiConfiguration"))
	expect(links).toContain(t("nav.account"))
	expect(rendered.host.querySelector("h1")?.textContent).toBe(t("account.heading"))
	expect(rendered.host.querySelector("[role=alert]")).not.toBeNull()
})

test("keeps the account name and log out in the sidebar footer", async () => {
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url.endsWith("/api/agents")) return json({ agents: [] })
		return json(
			url.endsWith("/api/me/permissions")
				? { permissions: ["admin"] }
				: { user: { username: "Admin", mustChangePassword: false } },
		)
	}) as typeof fetch)
	const rendered = await renderPage(<h1>{t("account.heading")}</h1>)
	const sidebar = rendered.host.querySelector("aside")
	const header = rendered.host.querySelector("header")
	const logout = [...rendered.host.querySelectorAll("button")].find(
		(button) => button.textContent === t("header.logout"),
	)
	expect(sidebar?.textContent).toContain("Admin")
	expect(logout && sidebar?.contains(logout)).toBe(true)
	expect(header?.contains(logout ?? null)).toBe(false)
})

test("closes the mobile navigation on a same-page navigation", async () => {
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (url.endsWith("/api/agents")) return json({ agents: [] })
		return json(
			url.endsWith("/api/me/permissions")
				? { permissions: ["admin"] }
				: { user: { username: "Admin", mustChangePassword: false } },
		)
	}) as typeof fetch)
	const rendered = await renderPage(<h1>{t("account.heading")}</h1>)
	const toggle = rendered.host.querySelector<HTMLButtonElement>(`button[aria-label="${t("header.toggleNavigation")}"]`)
	if (!toggle) throw new Error("Missing navigation toggle")
	await act(async () => toggle.click())
	expect(rendered.host.querySelector("#mobile-navigation")).not.toBeNull()
	await act(async () => rendered.router.navigate({ to: "/", hash: "filtered" }))
	await settle()
	expect(rendered.host.querySelector("#mobile-navigation")).toBeNull()
})

test("clears protected caches when discovery revokes access before the access refetch completes", async () => {
	let revoked = false
	let accessSignal: AbortSignal | null | undefined
	const accessResponse = Promise.withResolvers<Response>()
	spyOn(window, "confirm").mockReturnValue(true)
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		if (init?.method === "DELETE") {
			revoked = true
			return new Response(null, { status: 204 })
		}
		if (url.endsWith("/api/agents"))
			return json({ agents: revoked ? [] : [{ id: "agent", permissions: ["agents:read"] }] })
		if (url.endsWith("/api/me/permissions")) return json({ permissions: ["roles:manage", "users:read"] })
		if (url.endsWith("/access")) {
			if (revoked) {
				accessSignal = init?.signal
				return accessResponse.promise
			}
			return json({
				permissions: ["agents:read"],
				roles: [{ id: "role", name: "Support", permissions: ["agents:read"] }],
			})
		}
		return json({ user: { username: "Operator" } })
	}) as typeof fetch)
	const { host: container, queryClient } = await renderPage(
		<AgentAccessCard agentId="agent" permissions={["agents:read"]} />,
		"agents:read",
	)
	const protectedKeys = [
		["/api/agents/agent"],
		["/api/embeds/embed"],
		["/api/conversations/transcript"],
		["/api/stats"],
	]
	for (const key of protectedKeys) queryClient.setQueryData(key, { private: true })
	const remove = [...container.querySelectorAll("button")].find(
		(button) => button.textContent === t("agentAccess.remove"),
	)
	if (!remove) throw new Error("Missing removal button")
	await act(async () => remove.click())
	await settle()
	const confirm = [...document.querySelectorAll<HTMLButtonElement>("[role=dialog] button")].find(
		(button) => button.textContent === t("agentAccess.remove"),
	)
	if (!confirm) throw new Error("Missing removal confirmation")
	await act(async () => confirm.click())
	await settle()
	await settle()
	expect(accessSignal?.aborted).toBe(true)
	for (const key of protectedKeys) expect(queryClient.getQueryData(key)).toBeUndefined()
	expect(container.querySelector("h1")?.textContent).toBe(t("nav.users"))
	await act(async () => accessResponse.resolve(json({ code: "agent-not-found" }, 404)))
})
