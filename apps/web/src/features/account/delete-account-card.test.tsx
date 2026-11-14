import { json } from "@/testing/api-responses"
import { createTestHarness, type QueryClient, type Root } from "@/testing/component-harness"
import { click, findButton as button, typeInto as type } from "@/testing/dom"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { DeleteAccountCard } = await import("./delete-account-card")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, useBlocker } =
	await import("@tanstack/react-router")
const { t } = await import("i18next")

const PRIVATE_QUERY_KEY = ["delete-account-test"]

let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let permissions: string[]
let permissionsFailure: Response | undefined
let deleteResponse: Response

function problem(code: string, status: number): Response {
	return json({ code, type: `https://docs.talqo.chat/problems#${code}` }, status)
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
			{blocker.status === "blocked" ? <p data-testid="navigation-blocked" /> : null}
		</>
	)
}

function LoginDestination() {
	return <div data-testid="login-destination" />
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
	await renderRouter(root, queryClient, router)
	return router
}

function queryButton(label: string): HTMLButtonElement | undefined {
	return [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
}

function dialog(): HTMLElement {
	const found = document.querySelector<HTMLElement>("[role='alertdialog']")
	if (!found) throw new Error("delete dialog not open")
	return found
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
	permissionsFailure = undefined
	deleteResponse = new Response(null, { status: 204 })
	harness = createTestHarness({
		fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			const method = init?.method ?? "GET"
			if (url === "/api/me/permissions" && method === "GET") return permissionsFailure ?? json({ permissions })
			if (url === "/api/me" && method === "DELETE") return deleteResponse
			throw new Error(`unexpected request ${method} ${url}`)
		}) as typeof fetch,
	})
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
})

describe("account deletion", () => {
	test("hides the delete action from administrators", async () => {
		permissions = ["admin"]

		await renderPage()

		expect(queryButton(t("account.deleteAccount"))).toBeUndefined()
		expect(host.textContent).not.toContain(t("account.dangerZone"))
	})

	test("keeps the danger zone visible with a retry when permissions fail", async () => {
		permissionsFailure = problem("internal-server-error", 500)
		await renderPage()

		expect(host.textContent).toContain(t("account.dangerZone"))
		expect(host.querySelector("[role='alert']")?.textContent).toContain(t("problems.internal-server-error"))
		expect(queryButton(t("account.deleteAccount"))).toBeUndefined()

		permissionsFailure = undefined
		await click(button(t("common.retry")))

		expect(queryButton(t("account.deleteAccount"))).not.toBeUndefined()
		expect(host.querySelector("[role='alert']")).toBeNull()
	})

	test("keeps the confirmation open and cached data intact after deletion fails", async () => {
		deleteResponse = problem("internal-server-error", 500)
		const router = await renderPage()
		queryClient.setQueryData(PRIVATE_QUERY_KEY, { private: true })
		expect(document.querySelector("[role='alertdialog']")).toBeNull()

		await confirmDeletion()

		expect(dialog().textContent).toContain(t("problems.internal-server-error"))
		expect(router.state.location.pathname).toBe("/dashboard/account")
		expect(queryClient.getQueryData(PRIVATE_QUERY_KEY)).toEqual({ private: true })

		await click(button(t("account.cancel"), dialog()))
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		await click(button(t("account.deleteAccount")))
		expect(dialog().textContent).not.toContain(t("problems.internal-server-error"))
	})

	test("clears cached data and bypasses navigation blockers after deletion", async () => {
		const router = await renderPage(true)
		queryClient.setQueryData(PRIVATE_QUERY_KEY, { private: true })

		await confirmDeletion()

		expect(router.state.location.pathname).toBe("/login")
		expect(host.querySelector('[data-testid="login-destination"]')).not.toBeNull()
		expect(queryClient.getQueryData(PRIVATE_QUERY_KEY)).toBeUndefined()
		expect(host.querySelector('[data-testid="navigation-blocked"]')).toBeNull()
	})
})
