import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { Route } = await import("./account")
const { getGetSessionQueryKey } = await import("@/api/generated/identity/identity.ts")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const AccountPage = Route.options.component ?? (() => null)

const CURRENT_PASSWORD = "correct-horse-battery-staple"
const NEW_PASSWORD = "new-correct-horse-battery"
const PASSWORD_SELECTORS = ["#current-password", "#new-password", "#confirm-new-password"] as const

let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let updateUserResponse: Response
let changePasswordResponse: Response
let userUpdates: unknown[]
let passwordChanges: unknown[]

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function problem(code: string, status: number): Response {
	return json({ code, type: `https://docs.talqo.chat/problems#${code}` }, status)
}

function parseJsonBody(body: BodyInit | null | undefined): unknown {
	if (typeof body !== "string") throw new Error("Expected a JSON request body")
	return JSON.parse(body)
}

async function respond(request: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url
	const method = init?.method ?? "GET"
	if (url === "/api/auth/session" && method === "GET") {
		return json({ user: { id: "user", username: "operator", mustChangePassword: false } })
	}
	if (url === "/api/me/permissions" && method === "GET") return json({ permissions: [] })
	if (url === "/api/me/roles" && method === "GET") return json({ roles: [] })
	if (url === "/api/me" && method === "PATCH") {
		userUpdates.push(parseJsonBody(init?.body))
		return updateUserResponse
	}
	if (url === "/api/me/password" && method === "PATCH") {
		passwordChanges.push(parseJsonBody(init?.body))
		return changePasswordResponse
	}
	throw new Error(`unexpected request ${method} ${url}`)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPage() {
	const rootRoute = createRootRoute()
	const account = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard/account", component: AccountPage })
	const router = createRouter({
		routeTree: rootRoute.addChildren([account]),
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
}

function input(selector: string): HTMLInputElement {
	const found = host.querySelector<HTMLInputElement>(selector)
	if (!found) throw new Error(`input "${selector}" not rendered`)
	return found
}

function formStatus(selector: string): string | undefined {
	return input(selector).form?.querySelector("output")?.textContent ?? undefined
}

function button(label: string): HTMLButtonElement {
	const found = [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label)
	if (!found) throw new Error(`button "${label}" not rendered`)
	return found
}

async function type(element: HTMLInputElement, value: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function click(element: HTMLButtonElement) {
	await act(async () => element.click())
	await settle()
	await settle()
}

async function fillPasswords() {
	await type(input("#current-password"), CURRENT_PASSWORD)
	await type(input("#new-password"), NEW_PASSWORD)
	await type(input("#confirm-new-password"), NEW_PASSWORD)
}

function passwordValues() {
	return PASSWORD_SELECTORS.map((selector) => input(selector).value)
}

function sessionCache() {
	return queryClient.getQueryData(getGetSessionQueryKey())
}

beforeEach(() => {
	updateUserResponse = json({ user: { id: "user", username: "renamed", mustChangePassword: false } })
	changePasswordResponse = new Response(null, { status: 204 })
	userUpdates = []
	passwordChanges = []
	spyOn(globalThis, "fetch").mockImplementation(respond as typeof fetch)
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

describe("account settings", () => {
	test("preserves a rejected username and the cached session", async () => {
		updateUserResponse = problem("username-taken", 409)
		await renderPage()
		await type(input("#account-username"), "taken-name")

		await click(button(t("account.saveUsername")))

		expect(input("#account-username").value).toBe("taken-name")
		expect(host.querySelector("form [role='alert']")?.textContent).toBe(t("problems.username-taken"))
		expect(sessionCache()).toMatchObject({
			data: { user: { id: "user", username: "operator", mustChangePassword: false } },
			status: 200,
		})
	})

	test("updates the cached session and saved state after renaming", async () => {
		await renderPage()
		expect(formStatus("#account-username")).toBeUndefined()
		await type(input("#account-username"), "renamed")

		await click(button(t("account.saveUsername")))

		expect(userUpdates).toEqual([{ username: "renamed" }])
		expect(sessionCache()).toMatchObject({
			data: { user: { id: "user", username: "renamed", mustChangePassword: false } },
			status: 200,
		})
		expect(input("#account-username").value).toBe("renamed")
		expect(formStatus("#account-username")).toBe(t("account.usernameSaved"))
		expect(button(t("account.saveUsername")).disabled).toBe(true)

		await type(input("#account-username"), "renamed-again")
		expect(formStatus("#account-username")).toBeUndefined()
		expect(button(t("account.saveUsername")).disabled).toBe(false)
	})

	test("clears password secrets after changing without sending the confirmation", async () => {
		await renderPage()
		expect(formStatus("#current-password")).toBeUndefined()
		await fillPasswords()

		await click(button(t("account.changePassword")))

		expect(passwordChanges).toEqual([{ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD }])
		expect(passwordValues()).toEqual(["", "", ""])
		expect(formStatus("#current-password")).toBe(t("account.passwordSaved"))

		await type(input("#current-password"), CURRENT_PASSWORD)
		expect(formStatus("#current-password")).toBeUndefined()
	})

	test("retains every password field when the change fails", async () => {
		changePasswordResponse = problem("current-password-incorrect", 400)
		await renderPage()
		await fillPasswords()

		await click(button(t("account.changePassword")))

		expect(passwordValues()).toEqual([CURRENT_PASSWORD, NEW_PASSWORD, NEW_PASSWORD])
		expect(host.textContent).toContain(t("problems.current-password-incorrect"))
		expect(host.textContent).not.toContain(t("account.passwordSaved"))
	})
})
