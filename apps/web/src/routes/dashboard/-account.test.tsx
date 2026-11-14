import { json, parseJsonBody, problem } from "@/testing/api-responses"
import { act, createTestHarness, type QueryClient, type Root, settle } from "@/testing/component-harness"
import { renderRouter } from "@/testing/router"
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@talqo/shared"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { Route } = await import("./account")
const { getGetSessionQueryKey } = await import("@/api/generated/identity/identity.ts")
const { createMemoryHistory, createRootRoute, createRoute, createRouter } = await import("@tanstack/react-router")
const { t } = await import("i18next")

const AccountPage = Route.options.component ?? (() => null)

const CURRENT_PASSWORD = "correct-horse-battery-staple"
const NEW_PASSWORD = "new-correct-horse-battery"
const PASSWORD_SELECTORS = ["#current-password", "#new-password", "#confirm-new-password"] as const

let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let updateUserResponse: Response
let updateUserPending: Promise<Response> | undefined
let changePasswordResponse: Response
let userUpdates: unknown[]
let passwordChanges: unknown[]
let sessionUser: { id: string; username: string; mustChangePassword: boolean } | null
let sessionFailure: Response | undefined
let myPermissions: string[]
let permissionsFailure: Response | undefined
let myRoles: { id: string; name: string }[]
let rolesFailure: Response | undefined

async function respond(request: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url
	const method = init?.method ?? "GET"
	if (url === "/api/auth/session" && method === "GET") {
		return sessionFailure ?? json({ user: sessionUser })
	}
	if (url === "/api/me/permissions" && method === "GET")
		return permissionsFailure ?? json({ permissions: myPermissions })
	if (url === "/api/me/roles" && method === "GET") return rolesFailure ?? json({ roles: myRoles })
	if (url === "/api/me" && method === "PATCH") {
		userUpdates.push(parseJsonBody(init?.body))
		return updateUserPending ?? updateUserResponse
	}
	if (url === "/api/me/password" && method === "PATCH") {
		passwordChanges.push(parseJsonBody(init?.body))
		return changePasswordResponse
	}
	throw new Error(`unexpected request ${method} ${url}`)
}

async function renderPage() {
	const rootRoute = createRootRoute()
	const account = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard/account", component: AccountPage })
	const router = createRouter({
		routeTree: rootRoute.addChildren([account]),
		history: createMemoryHistory({ initialEntries: ["/dashboard/account"] }),
	})
	await renderRouter(root, queryClient, router)
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
	updateUserPending = undefined
	changePasswordResponse = new Response(null, { status: 204 })
	userUpdates = []
	passwordChanges = []
	sessionUser = { id: "user", username: "operator", mustChangePassword: false }
	sessionFailure = undefined
	myPermissions = []
	permissionsFailure = undefined
	myRoles = []
	rolesFailure = undefined
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
	window.localStorage.removeItem("talqo-language")
	document.documentElement.lang = "en"
})

describe("account settings", () => {
	test("lists the operator's roles", async () => {
		myRoles = [{ id: "support", name: "Support" }]
		await renderPage()

		expect(host.textContent).toContain("Support")
		expect(host.textContent).not.toContain(t("team.adminBadge"))
		expect(host.textContent).not.toContain(t("account.noRoles"))
	})

	test("marks an admin even when they have no roles", async () => {
		myPermissions = ["admin"]
		await renderPage()

		expect(host.textContent).toContain(t("team.adminBadge"))
		expect(host.textContent).not.toContain(t("account.noRoles"))
	})

	test("explains when a non-admin has no roles", async () => {
		await renderPage()

		expect(host.textContent).toContain(t("account.noRoles"))
	})

	test("retries loading roles and shows them", async () => {
		rolesFailure = problem("internal-server-error", 500)
		await renderPage()
		expect(host.querySelector("[role='alert'] p")?.textContent).toBe(t("problems.internal-server-error"))

		myRoles = [{ id: "support", name: "Support" }]
		rolesFailure = undefined
		await click(button(t("common.retry")))

		expect(host.textContent).toContain("Support")
		expect(host.querySelector("[role='alert']")).toBeNull()
	})

	test("explains a session without a user and recovers on retry", async () => {
		sessionUser = null
		await renderPage()

		expect(host.querySelector("[role='alert'] p")?.textContent).toBe(t("account.loadFailed"))
		expect(host.querySelector("#account-username")).toBeNull()

		sessionUser = { id: "user", username: "operator", mustChangePassword: false }
		await click(button(t("common.retry")))

		expect(input("#account-username").value).toBe("operator")
	})

	test("does not claim admin access when permissions cannot be loaded", async () => {
		permissionsFailure = problem("internal-server-error", 500)
		await renderPage()

		expect(host.textContent).not.toContain(t("team.adminBadge"))
		expect(input("#account-username").value).toBe("operator")
	})

	test("shows a pending username save without allowing a second one", async () => {
		const pending = Promise.withResolvers<Response>()
		updateUserPending = pending.promise
		await renderPage()
		await type(input("#account-username"), "renamed")

		await click(button(t("account.saveUsername")))

		expect(button(t("account.savingUsername")).disabled).toBe(true)
		expect(userUpdates).toEqual([{ username: "renamed" }])

		await act(async () =>
			pending.resolve(json({ user: { id: "user", username: "renamed", mustChangePassword: false } })),
		)
		await settle()
		expect(formStatus("#account-username")).toBe(t("account.usernameSaved"))
	})

	test("rejects an invalid username locally and focuses the field", async () => {
		await renderPage()
		expect(input("#account-username").getAttribute("aria-describedby")).toBe("account-username-description")
		await type(input("#account-username"), "x")
		input("#account-username").blur()

		await click(button(t("account.saveUsername")))

		expect(userUpdates).toEqual([])
		expect(input("#account-username").getAttribute("aria-invalid")).toBe("true")
		expect(input("#account-username").getAttribute("aria-describedby")).toBe(
			"account-username-description account-username-error",
		)
		expect(host.querySelector("#account-username-error")?.textContent).toBe(
			t("account.usernameInvalid", { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH }),
		)
		expect(document.activeElement).toBe(input("#account-username"))
	})

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

		updateUserResponse = json({ user: { id: "user", username: "renamed", mustChangePassword: false } })
		await type(input("#account-username"), "renamed")
		await click(button(t("account.saveUsername")))

		expect(host.querySelector("form [role='alert']")).toBeNull()
		expect(formStatus("#account-username")).toBe(t("account.usernameSaved"))
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

		changePasswordResponse = new Response(null, { status: 204 })
		await click(button(t("account.changePassword")))

		expect(host.textContent).not.toContain(t("problems.current-password-incorrect"))
		expect(formStatus("#current-password")).toBe(t("account.passwordSaved"))
	})
})
