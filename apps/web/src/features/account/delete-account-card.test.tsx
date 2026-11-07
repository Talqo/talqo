import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { DeleteAccountCard } = await import("./delete-account-card")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider, useBlocker } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const PRIVATE_QUERY_KEY = ["delete-account-test"]

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let permissions: string[]
let deleteResponse: Response

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function problem(code: string, status: number): Response {
	return json({ code, type: `https://docs.talqo.chat/problems#${code}` }, status)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

function AccountWithDelete({ blockNavigation }: { blockNavigation: boolean }) {
	const blocker = useBlocker({
		shouldBlockFn: () => blockNavigation,
		enableBeforeUnload: false,
		withResolver: true,
	})
	return (
		<>
			<DeleteAccountCard username="operator" />
			{blocker.status === "blocked" ? <p>Navigation blocked</p> : null}
		</>
	)
}

function LoginDestination() {
	return <h1>Login destination</h1>
}

async function renderPage(blockNavigation = false) {
	const rootRoute = createRootRoute()
	const account = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/account",
		component: () => <AccountWithDelete blockNavigation={blockNavigation} />,
	})
	const login = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginDestination })
	const router = createRouter({
		routeTree: rootRoute.addChildren([account, login]),
		history: createMemoryHistory({ initialEntries: ["/dashboard/account"] }),
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

function button(label: string, scope: ParentNode = host): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
	if (!found) throw new Error(`button "${label}" not rendered`)
	return found
}

function queryButton(label: string): HTMLButtonElement | undefined {
	return [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
}

function dialog(): HTMLElement {
	const found = document.querySelector<HTMLElement>("[role='alertdialog']")
	if (!found) throw new Error("delete dialog not open")
	return found
}

async function click(element: HTMLButtonElement) {
	await act(async () => element.click())
	await settle()
	await settle()
}

async function type(element: HTMLInputElement, value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function confirmDeletion() {
	await click(button(t("account.deleteAccount")))
	const confirmation = dialog().querySelector<HTMLInputElement>("input")
	if (!confirmation) throw new Error("username confirmation not rendered")
	await type(confirmation, "operator")
	await click(button(t("account.deleteAccount"), dialog()))
}

beforeEach(() => {
	permissions = []
	deleteResponse = new Response(null, { status: 204 })
	spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
		const method = init?.method ?? "GET"
		if (url === "/api/me/permissions" && method === "GET") return json({ permissions })
		if (url === "/api/me" && method === "DELETE") return deleteResponse
		throw new Error(`unexpected request ${method} ${url}`)
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
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
})

describe("account deletion", () => {
	test("hides the delete action from administrators", async () => {
		permissions = ["admin"]

		await renderPage()

		expect(queryButton(t("account.deleteAccount")) === undefined).toBe(true)
		expect(host.textContent).not.toContain(t("account.dangerZone"))
	})

	test("keeps the confirmation open and cached data intact after deletion fails", async () => {
		deleteResponse = problem("internal-server-error", 500)
		const router = await renderPage()
		queryClient.setQueryData(PRIVATE_QUERY_KEY, { private: true })

		await confirmDeletion()

		expect(dialog().textContent).toContain(t("problems.internal-server-error"))
		expect(router.state.location.pathname).toBe("/dashboard/account")
		expect(queryClient.getQueryData(PRIVATE_QUERY_KEY)).toEqual({ private: true })
	})

	test("clears cached data and bypasses navigation blockers after deletion", async () => {
		const router = await renderPage(true)
		queryClient.setQueryData(PRIVATE_QUERY_KEY, { private: true })

		await confirmDeletion()

		expect(router.state.location.pathname).toBe("/login")
		expect(host.querySelector("h1")?.textContent).toBe("Login destination")
		expect(queryClient.getQueryData(PRIVATE_QUERY_KEY)).toBeUndefined()
		expect(host.textContent).not.toContain("Navigation blocked")
	})
})
