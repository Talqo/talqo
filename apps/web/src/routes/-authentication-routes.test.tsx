import { json, problem } from "@/testing/api-responses"
import { act, createTestHarness, type QueryClient, type Root, settle } from "@/testing/component-harness"
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@talqo/shared"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { Route: IndexRoute } = await import("./index")
const { Route: DashboardRoute } = await import("./dashboard/route")
const { Route: ForcePasswordChangeRoute } = await import("./force-password-change")
const { Route: LoginRoute } = await import("./login")
const { Route: SetupRoute } = await import("./setup")
const { Route: AcceptInviteRoute } = await import("./accept-invite")
const { LanguageProvider } = await import("@/lib/use-language")
const { ThemeProvider } = await import("@/lib/use-theme")
const { QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { t } = await import("i18next")

const LoginPage = LoginRoute.options.component ?? (() => null)
const SetupPage = SetupRoute.options.component ?? (() => null)
const ForcePasswordChangePage = ForcePasswordChangeRoute.options.component ?? (() => null)
const AcceptInvitePage = AcceptInviteRoute.options.component ?? (() => null)

const CACHE_KEY = ["authentication-route-test"]
const CACHED_VALUE = { private: true }
const REGULAR_USER = { id: "user", username: "operator", mustChangePassword: false }
const FORCED_USER = { ...REGULAR_USER, mustChangePassword: true }
const PASSWORD = "correct-horse-battery-staple"

type SessionUser = typeof REGULAR_USER
type SubmitScenario = {
	name: string
	initialPath: string
	fields: readonly (readonly [string, string])[]
	apiUrl: string
	method: string
	expectedBody: Record<string, string>
	successResponse: () => Response
	clearsCache?: boolean
	requiresForcedSession?: boolean
}

const SUBMIT_SCENARIOS = [
	{
		name: "login",
		initialPath: "/login",
		fields: [
			["#username", "operator"],
			["#password", PASSWORD],
		],
		apiUrl: "/api/auth/login",
		method: "POST",
		expectedBody: { username: "operator", password: PASSWORD },
		successResponse: () => json({ user: REGULAR_USER }),
		clearsCache: true,
	},
	{
		name: "setup",
		initialPath: "/setup",
		fields: [
			["#username", "first-admin"],
			["#password", PASSWORD],
			["#confirmPassword", PASSWORD],
		],
		apiUrl: "/api/setup",
		method: "POST",
		expectedBody: { username: "first-admin", password: PASSWORD },
		successResponse: () => json({ user: REGULAR_USER }, 201),
		clearsCache: true,
	},
	{
		name: "forced password change",
		initialPath: "/force-password-change",
		fields: [
			["#new-password", PASSWORD],
			["#confirm-new-password", PASSWORD],
		],
		apiUrl: "/api/me/password/forced",
		method: "PATCH",
		expectedBody: { newPassword: PASSWORD },
		successResponse: () => new Response(null, { status: 204 }),
		requiresForcedSession: true,
	},
	{
		name: "invitation acceptance",
		initialPath: "/accept-invite?token=invite%20token%2B%2F%3D%26",
		fields: [
			["#username", "new-member"],
			["#password", PASSWORD],
			["#confirmPassword", PASSWORD],
		],
		apiUrl: "/api/invitations/redeem",
		method: "POST",
		expectedBody: { token: "invite token+/=&", username: "new-member", password: PASSWORD },
		successResponse: () => json({ user: REGULAR_USER }, 201),
		clearsCache: true,
	},
] satisfies readonly SubmitScenario[]

let requests: { body: unknown; method: string; url: string }[]
let setupNeeded: boolean
let sessionUser: SessionUser | null
let mutationResponse: Response | undefined
let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>

function parseBody(body: BodyInit | null | undefined): unknown {
	if (body == null) return undefined
	if (typeof body !== "string") throw new Error("Expected a JSON request body")
	return JSON.parse(body)
}

function forcedPasswordRequests() {
	return requests.filter(({ url, method }) => url === "/api/me/password/forced" && method === "PATCH")
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	const method = init?.method ?? "GET"
	requests.push({ url, method, body: parseBody(init?.body) })
	if (url === "/api/setup" && method === "GET") return json({ needsSetup: setupNeeded })
	if (url === "/api/auth/session" && method === "GET") return json({ user: sessionUser })
	const isMutation =
		(url === "/api/auth/login" && method === "POST") ||
		(url === "/api/setup" && method === "POST") ||
		(url === "/api/me/password/forced" && method === "PATCH") ||
		(url === "/api/invitations/redeem" && method === "POST")
	if (isMutation && mutationResponse) return mutationResponse
	throw new Error(`unexpected request ${method} ${url}`)
}

function makeGuardRouter(initialPath: string) {
	const rootRoute = createRootRoute()
	const index = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		beforeLoad: IndexRoute.options.beforeLoad,
	})
	const dashboard = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard",
		beforeLoad: DashboardRoute.options.beforeLoad,
	})
	const forcePasswordChange = createRoute({
		getParentRoute: () => rootRoute,
		path: "/force-password-change",
		beforeLoad: ForcePasswordChangeRoute.options.beforeLoad,
	})
	const login = createRoute({ getParentRoute: () => rootRoute, path: "/login" })
	const setup = createRoute({ getParentRoute: () => rootRoute, path: "/setup" })
	return createRouter({
		routeTree: rootRoute.addChildren([index, dashboard, forcePasswordChange, login, setup]),
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	})
}

function DashboardDestination() {
	return <div data-testid="dashboard-destination" />
}

function makeSubmitRouter(initialPath: string) {
	const rootRoute = createRootRoute()
	const login = createRoute({ getParentRoute: () => rootRoute, path: "/login", component: LoginPage })
	const setup = createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: SetupPage })
	const forcePasswordChange = createRoute({
		getParentRoute: () => rootRoute,
		path: "/force-password-change",
		beforeLoad: ForcePasswordChangeRoute.options.beforeLoad,
		component: ForcePasswordChangePage,
	})
	const acceptInvite = createRoute({
		getParentRoute: () => rootRoute,
		path: "/accept-invite",
		validateSearch: AcceptInviteRoute.options.validateSearch,
		component: AcceptInvitePage,
	})
	const dashboard = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard",
		component: DashboardDestination,
	})
	return createRouter({
		routeTree: rootRoute.addChildren([login, setup, forcePasswordChange, acceptInvite, dashboard]),
		history: createMemoryHistory({ initialEntries: [initialPath] }),
	})
}

async function renderSubmitRoute(initialPath: string) {
	const router = makeSubmitRouter(initialPath)
	queryClient.setQueryData(CACHE_KEY, CACHED_VALUE)
	await act(async () => {
		await router.load()
		root.render(
			<ThemeProvider>
				<LanguageProvider>
					<QueryClientProvider client={queryClient}>
						<RouterProvider router={router} />
					</QueryClientProvider>
				</LanguageProvider>
			</ThemeProvider>,
		)
	})
	await settle()
	await settle()
	return router
}

async function fill(selector: string, value: string) {
	const input = host.querySelector<HTMLInputElement>(selector)
	if (!input) throw new Error(`input "${selector}" not rendered`)
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
		input.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function fillForm(fields: SubmitScenario["fields"]) {
	for (const [selector, value] of fields) {
		// Each act() must finish before the next controlled input updates.
		// eslint-disable-next-line no-await-in-loop
		await fill(selector, value)
	}
}

async function submitForm() {
	const submit = host.querySelector<HTMLButtonElement>("button[type='submit']")
	if (!submit) throw new Error("submit button not rendered")
	await act(async () => submit.click())
	await settle()
	await settle()
}

beforeEach(() => {
	requests = []
	setupNeeded = false
	sessionUser = REGULAR_USER
	mutationResponse = undefined
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("route guards", () => {
	for (const [needsSetup, destination] of [
		[true, "/setup"],
		[false, "/login"],
	] as const) {
		test(`sends the root route to ${destination} when needsSetup is ${needsSetup}`, async () => {
			setupNeeded = needsSetup
			const router = makeGuardRouter("/")
			await router.load()

			expect(router.state.location.pathname).toBe(destination)
			expect(requests).toEqual([{ url: "/api/setup", method: "GET", body: undefined }])
		})
	}

	for (const scenario of [
		{ name: "a missing session", user: null, destination: "/login" },
		{ name: "a forced password change", user: FORCED_USER, destination: "/force-password-change" },
		{ name: "a regular session", user: REGULAR_USER, destination: "/dashboard" },
	]) {
		test(`maps ${scenario.name} at the dashboard boundary`, async () => {
			sessionUser = scenario.user
			const router = makeGuardRouter("/dashboard")
			await router.load()

			expect(router.state.location.pathname).toBe(scenario.destination)
		})
	}

	for (const scenario of [
		{ name: "redirects a missing session to login", user: null, destination: "/login" },
		{ name: "redirects a non-forced session to the dashboard", user: REGULAR_USER, destination: "/dashboard" },
		{ name: "keeps a forced session on the password form", user: FORCED_USER, destination: "/force-password-change" },
	]) {
		test(scenario.name, async () => {
			sessionUser = scenario.user
			const router = makeGuardRouter("/force-password-change")
			await router.load()

			expect(router.state.location.pathname).toBe(scenario.destination)
		})
	}
})

describe("authentication route submissions", () => {
	for (const scenario of SUBMIT_SCENARIOS) {
		test(`${scenario.name} sends its exact payload and enters the dashboard after success`, async () => {
			if (scenario.requiresForcedSession) sessionUser = FORCED_USER
			mutationResponse = scenario.successResponse()
			const router = await renderSubmitRoute(scenario.initialPath)
			await fillForm(scenario.fields)

			await submitForm()

			expect(requests.filter(({ url, method }) => url === scenario.apiUrl && method === scenario.method)).toEqual([
				{ url: scenario.apiUrl, method: scenario.method, body: scenario.expectedBody },
			])
			expect(router.state.location.pathname).toBe("/dashboard")
			expect(host.querySelector('[data-testid="dashboard-destination"]')).not.toBeNull()
			if (scenario.clearsCache) expect(queryClient.getQueryData(CACHE_KEY)).toBeUndefined()
		})

		test(`${scenario.name} keeps its error, location, and cache after failure`, async () => {
			if (scenario.requiresForcedSession) sessionUser = FORCED_USER
			mutationResponse = problem("internal-server-error", 500)
			const router = await renderSubmitRoute(scenario.initialPath)
			const initialHref = router.state.location.href
			await fillForm(scenario.fields)

			await submitForm()

			expect(host.querySelector("[role='alert']")?.textContent).toBe(t("problems.internal-server-error"))
			expect(router.state.location.href).toBe(initialHref)
			expect(queryClient.getQueryData(CACHE_KEY)).toEqual(CACHED_VALUE)
		})
	}

	test("validates the forced password before sending it", async () => {
		sessionUser = FORCED_USER
		const router = await renderSubmitRoute("/force-password-change")

		await fill("#new-password", "short")
		await fill("#confirm-new-password", "short")
		await submitForm()
		expect(host.querySelector("#new-password-error")?.textContent).toBe(
			t("account.newPasswordError", { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH }),
		)
		expect(host.querySelector<HTMLInputElement>("#new-password")?.getAttribute("aria-invalid")).toBe("true")
		expect(host.querySelector<HTMLInputElement>("#new-password")?.getAttribute("aria-describedby")).toBe(
			"new-password-error",
		)
		expect(forcedPasswordRequests()).toEqual([])

		await fill("#new-password", PASSWORD)
		await fill("#confirm-new-password", `${PASSWORD}-other`)
		await submitForm()
		expect(host.querySelector("#confirm-new-password-error")?.textContent).toBe(t("account.passwordMismatchError"))
		expect(host.querySelector<HTMLInputElement>("#confirm-new-password")?.getAttribute("aria-invalid")).toBe("true")
		expect(host.querySelector<HTMLInputElement>("#confirm-new-password")?.getAttribute("aria-describedby")).toBe(
			"confirm-new-password-error",
		)
		expect(forcedPasswordRequests()).toEqual([])
		expect(router.state.location.pathname).toBe("/force-password-change")
	})

	test("shows an invitation error without a form when the token is missing", async () => {
		await renderSubmitRoute("/accept-invite")

		expect(host.querySelector("[role='alert']")?.textContent).toBe(t("auth.acceptInvite.missingToken"))
		expect(host.querySelector("form") === null).toBe(true)
		expect(requests).toEqual([])
	})
})
