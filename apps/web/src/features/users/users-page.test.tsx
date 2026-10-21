import type { Role } from "@/api/generated/models/role.zod"
import type { Root } from "react-dom/client"

import { ListUsers200 } from "@/api/generated/models/roles/listUsers200.zod"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

// Component test files share one process, so only the first one registers the DOM.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { UsersPage } = await import("./users-page")
const { LanguageProvider } = await import("@/lib/use-language")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRouter, createRootRoute, createMemoryHistory, RouterContextProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

type ListedUser = {
	id: string
	mustChangePassword: boolean | null
	permissions: string[]
	canManage: boolean
	roles: { id: string; name: string }[]
	username: string
}

const EVERYTHING = ["admin", "users:read", "users:manage", "roles:manage", "ai_provider:manage"]

let myPermissions: string[]
let users: ListedUser[]
let roles: Role[]
let assignFailure: Response | undefined
let rolesFailure: Response | undefined
let rolesResponse: Promise<Response> | undefined
let requests: { body: unknown; method: string; url: string }[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() })

function user(username: string, overrides: Partial<ListedUser> = {}): ListedUser {
	return {
		id: username,
		username,
		mustChangePassword: false,
		permissions: [],
		canManage: true,
		roles: [],
		...overrides,
	}
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
	const method = init?.method ?? "GET"
	requests.push({ url, method, body: init?.body ? parseJsonBody(init.body) : undefined })
	if (url === "/api/me/permissions") return json({ permissions: myPermissions })
	if (url === "/api/auth/session") return json({ user: { id: "me", username: "me", mustChangePassword: false } })
	if (url === "/api/users") return json({ users })
	if (url === "/api/roles") return rolesResponse ?? rolesFailure ?? json({ roles, manageableRoleIds: roles.map((role) => role.id) })
	if (url === "/api/invitations" && method === "POST")
		return json({ token: "invite", expiresAt: "2026-10-25T00:00:00Z" }, 201)
	if (url === "/api/permissions") {
		return json({
			permissions: [
				{ permission: "users:read", implies: [] },
				{ permission: "users:manage", implies: ["users:read"] },
				{ permission: "roles:manage", implies: ["users:read"] },
				{ permission: "ai_provider:manage", implies: [] },
			],
		})
	}
	if (/^\/api\/users\/[^/]+\/roles$/.test(url) && method === "PUT") {
		if (assignFailure) return assignFailure
		const { roleIds } = parseJsonBody(init?.body) as { roleIds: string[] }
		return json({ roles: roles.filter(({ id }) => roleIds.includes(id)).map(({ id, name }) => ({ id, name })) })
	}
	throw new Error(`unexpected request ${method} ${url}`)
}

function parseJsonBody(body: BodyInit | null | undefined): unknown {
	if (typeof body !== "string") throw new Error("Expected a JSON request body")
	return JSON.parse(body)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPage() {
	await act(async () =>
		root.render(
			<RouterContextProvider router={router}>
				<QueryClientProvider client={queryClient}>
					<LanguageProvider>
						<UsersPage />
					</LanguageProvider>
				</QueryClientProvider>
			</RouterContextProvider>,
		),
	)
	// Roles load only after permissions resolve, so give the dependent queries a second turn.
	await settle()
	await settle()
}

function card(username: string): HTMLElement {
	const found = host.querySelector<HTMLElement>(`[data-user-id='${username}']`)
	if (!found) throw new Error(`user "${username}" not rendered`)
	return found
}

function problem(code: string, status: number): Response {
	return json({ code, type: `https://docs.talqo.chat/problems#${code}` }, status)
}

function requestCount(url: string): number {
	return requests.filter((request) => request.url === url && request.method === "GET").length
}

function buttonNames(scope: ParentNode): string[] {
	return [...scope.querySelectorAll("button")].map((element) => element.textContent?.trim() ?? "")
}

function button(name: string, scope: ParentNode = document): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)
	if (!found) throw new Error(`button "${name}" not rendered`)
	return found
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
}

function checkbox(label: string): HTMLElement {
	const labelElement = [...document.querySelectorAll("label")].find((element) => element.textContent?.trim() === label)
	const input = labelElement
		? document.querySelector<HTMLElement>(`[role='checkbox'][aria-labelledby='${labelElement.id}']`)
		: null
	if (!input) throw new Error(`checkbox "${label}" not rendered`)
	return input
}

function dialog(): HTMLElement {
	const found = document.querySelector<HTMLElement>("[role='dialog']")
	if (!found) throw new Error("dialog not open")
	return found
}

beforeEach(() => {
	myPermissions = EVERYTHING
	users = []
	roles = []
	assignFailure = undefined
	rolesFailure = undefined
	rolesResponse = undefined
	requests = []
	spyOn(globalThis, "fetch").mockImplementation(respond as typeof fetch)
	queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
	router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() })
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

describe("UsersPage", () => {
	test("allows a role-less invitation after roles fail to load and explains the failure", async () => {
		rolesFailure = problem("internal-server-error", 500)
		await renderPage()
		expect(button(t("auth.invitations.heading")).disabled).toBe(false)
		await click(button(t("auth.invitations.heading")))
		expect(dialog().textContent).toContain(t("problems.internal-server-error"))
		expect(dialog().textContent).toContain(t("auth.invitations.noRoles"))
		await click(button(t("auth.invitations.create"), dialog()))
		expect(requests.find(({ method, url }) => method === "POST" && url === "/api/invitations")?.body).toEqual({
			roleIds: [],
		})
	})

	test("retries role loading inside the invitation dialog without silently selecting roles", async () => {
		rolesFailure = problem("internal-server-error", 500)
		roles = [{ id: "default", name: "Default", permissions: [], memberCount: 0 }]
		await renderPage()
		await click(button(t("auth.invitations.heading")))
		rolesFailure = undefined
		await click(button(t("common.retry"), dialog()))
		expect(dialog().querySelector("[role='alert']")).toBeNull()
		expect(checkbox("Default").getAttribute("aria-checked")).toBe("false")
		await click(checkbox("Default"))
		await click(button(t("auth.invitations.create"), dialog()))
		expect(requests.find(({ method, url }) => method === "POST" && url === "/api/invitations")?.body).toEqual({
			roleIds: ["default"],
		})
	})

	test("preselects Default for invitations and submits exactly the edited selection", async () => {
		roles = [
			{ id: "default", name: "Renamed default", permissions: [], memberCount: 0 },
			{ id: "support", name: "Support", permissions: ["agents:read"], memberCount: 0 },
		]
		await renderPage()
		await click(button(t("auth.invitations.heading")))
		expect(checkbox("Renamed default").getAttribute("aria-checked")).toBe("true")
		expect(dialog().textContent).not.toContain(t("auth.invitations.noRoles"))
		await click(checkbox("Renamed default"))
		expect(dialog().textContent).toContain(t("auth.invitations.noRoles"))
		await click(checkbox("Support"))
		expect(dialog().textContent).not.toContain(t("auth.invitations.noRoles"))
		await click(button(t("auth.invitations.create"), dialog()))
		expect(requests.find(({ method, url }) => method === "POST" && url === "/api/invitations")?.body).toEqual({
			roleIds: ["support"],
		})
	})

	test("keeps the selected roles visible when a background refresh fails", async () => {
		roles = [{ id: "default", name: "Default", permissions: [], memberCount: 0 }]
		await renderPage()
		await click(button(t("auth.invitations.heading")))
		rolesFailure = problem("internal-server-error", 500)
		await act(() => queryClient.refetchQueries())
		await settle()
		expect(dialog().textContent).toContain(t("problems.internal-server-error"))
		expect(checkbox("Default").getAttribute("aria-checked")).toBe("true")
		await click(checkbox("Default"))
		await click(button(t("auth.invitations.create"), dialog()))
		expect(requests.find(({ method, url }) => method === "POST" && url === "/api/invitations")?.body).toEqual({
			roleIds: [],
		})
	})

	test("allows invitations with no selected roles when Default is absent", async () => {
		await renderPage()
		await click(button(t("auth.invitations.heading")))
		await click(button(t("auth.invitations.create"), dialog()))
		expect(requests.find(({ method, url }) => method === "POST" && url === "/api/invitations")?.body).toEqual({
			roleIds: [],
		})
	})

	test("explains unavailable invitation roles and does not preselect access the operator lacks", async () => {
		myPermissions = ["users:read", "users:manage", "roles:manage"]
		roles = [{ id: "default", name: "Default", permissions: ["agents:manage"], memberCount: 0 }]
		await renderPage()
		await click(button(t("auth.invitations.heading")))
		expect(checkbox("Default").getAttribute("aria-disabled")).toBe("true")
		expect(checkbox("Default").getAttribute("aria-checked")).toBe("false")
		expect(dialog().textContent).toContain(t("users.roleNotYours"))
	})
	test("shows a read-only list with role and admin badges to an operator who can only see users", async () => {
		myPermissions = ["users:read"]
		users = [
			user("owner", { permissions: EVERYTHING, canManage: false, mustChangePassword: null }),
			user("helper", { roles: [{ id: "support", name: "Support" }], mustChangePassword: null }),
		]
		await renderPage()

		expect(ListUsers200.safeParse({ users }).success).toBe(true)
		expect(card("owner").textContent).toContain(t("users.adminBadge"))
		expect(card("helper").textContent).toContain("Support")
		expect(buttonNames(host)).toEqual([])
	})

	test("offers user actions only for users whose access the operator holds", async () => {
		myPermissions = ["users:read", "users:manage"]
		users = [user("reader"), user("editor", { canManage: false })]
		await renderPage()

		expect(buttonNames(host)).toContain(t("auth.invitations.heading"))
		expect(buttonNames(card("reader"))).toEqual([t("users.resetPassword"), t("users.delete")])
		expect(buttonNames(card("editor"))).toEqual([])
		expect(card("editor").textContent).toContain(t("users.cannotChange"))
	})

	test("lets a role manager assign only roles within their own access", async () => {
		myPermissions = ["users:read", "roles:manage"]
		roles = [
			{ id: "readers", name: "Readers", permissions: ["users:read"], memberCount: 0 },
			{ id: "ai", name: "AI team", permissions: ["ai_provider:manage"], memberCount: 0 },
		]
		users = [user("helper")]
		await renderPage()
		expect(buttonNames(card("helper"))).toEqual([t("users.editRoles")])

		await click(button(t("users.editRoles"), card("helper")))
		expect(checkbox("AI team").getAttribute("aria-disabled")).toBe("true")
		expect(dialog().textContent).toContain(t("users.roleNotYours"))
		await click(checkbox("Readers"))
		await click(button(t("users.saveRoles"), dialog()))

		expect(requests.find(({ method }) => method === "PUT")).toEqual({
			url: "/api/users/helper/roles",
			method: "PUT",
			body: { roleIds: ["readers"] },
		})
	})

	test("warns before an operator removes their own only way to manage roles", async () => {
		myPermissions = ["users:read", "roles:manage"]
		roles = [{ id: "managers", name: "Managers", permissions: ["roles:manage"], memberCount: 1 }]
		users = [user("me", { roles: [{ id: "managers", name: "Managers" }] })]
		await renderPage()

		await click(button(t("users.editRoles"), card("me")))
		expect(dialog().textContent).not.toContain(t("users.lockoutWarning"))
		await click(checkbox("Managers"))

		expect(dialog().textContent).toContain(t("users.lockoutWarning"))
	})

	test("shows the admin to a non-admin manager with a note instead of reset and delete", async () => {
		myPermissions = ["users:read", "users:manage", "roles:manage"]
		users = [user("owner", { permissions: EVERYTHING, canManage: false })]
		await renderPage()

		expect(card("owner").textContent).toContain(t("users.adminBadge"))
		expect(card("owner").textContent).toContain(t("users.cannotChange"))
		expect(buttonNames(card("owner"))).toEqual([t("users.editRoles")])
	})

	test("keeps the operator's own reset and delete unavailable but offers role editing", async () => {
		myPermissions = ["users:read", "users:manage", "roles:manage"]
		users = [user("me")]
		await renderPage()

		expect(buttonNames(card("me"))).toEqual([t("users.editRoles"), t("users.resetPassword"), t("users.delete")])
		expect(button(t("users.editRoles"), card("me")).disabled).toBe(false)
		expect(button(t("users.resetPassword"), card("me")).disabled).toBe(true)
		expect(button(t("users.delete"), card("me")).disabled).toBe(true)
	})

	test("says so when roles cannot be loaded instead of silently hiding role editing", async () => {
		myPermissions = ["users:read", "roles:manage"]
		rolesFailure = problem("internal-server-error", 500)
		users = [user("helper"), user("other")]
		await renderPage()

		expect(button(t("users.editRoles"), card("helper")).disabled).toBe(true)
		expect(host.querySelectorAll("[role='alert']")).toHaveLength(1)
		rolesFailure = undefined
		await click(button(t("common.retry"), host))
		expect(button(t("users.editRoles"), card("helper")).disabled).toBe(false)
	})

	test("keeps role editing visible but unavailable while roles load", async () => {
		myPermissions = ["users:read", "roles:manage"]
		users = [user("helper")]
		const deferred = Promise.withResolvers<Response>()
		rolesResponse = deferred.promise
		await renderPage()
		expect(button(t("users.editRoles"), card("helper")).disabled).toBe(true)
		await act(async () => deferred.resolve(json({ roles: [], manageableRoleIds: [] })))
		await settle()
		expect(button(t("users.editRoles"), card("helper")).disabled).toBe(false)
	})

	test("starts from the user's current roles every time the dialog opens", async () => {
		roles = [{ id: "readers", name: "Readers", permissions: ["users:read"], memberCount: 0 }]
		users = [user("helper")]
		await renderPage()
		users = [user("helper", { roles: [{ id: "readers", name: "Readers" }] })]
		await act(() => queryClient.refetchQueries())
		await settle()

		await click(button(t("users.editRoles"), card("helper")))
		expect(checkbox("Readers").getAttribute("aria-checked")).toBe("true")
		await click(checkbox("Readers"))
		await click(button(t("users.cancel"), dialog()))
		await click(button(t("users.editRoles"), card("helper")))

		expect(checkbox("Readers").getAttribute("aria-checked")).toBe("true")
	})

	test("closes and refreshes users and the operator's own access after saving", async () => {
		roles = [{ id: "readers", name: "Readers", permissions: ["users:read"], memberCount: 0 }]
		users = [user("helper")]
		await renderPage()
		const usersBefore = requestCount("/api/users")
		const permissionsBefore = requestCount("/api/me/permissions")

		await click(button(t("users.editRoles"), card("helper")))
		await click(checkbox("Readers"))
		await click(button(t("users.saveRoles"), dialog()))

		expect(document.querySelector("[role='dialog']")).toBeNull()
		expect(requestCount("/api/users")).toBeGreaterThan(usersBefore)
		expect(requestCount("/api/me/permissions")).toBeGreaterThan(permissionsBefore)
	})

	test("shows the server's reason when saving roles fails and keeps the dialog open", async () => {
		assignFailure = problem("permission-exceeds-own", 403)
		roles = [{ id: "readers", name: "Readers", permissions: ["users:read"], memberCount: 0 }]
		users = [user("helper")]
		await renderPage()

		await click(button(t("users.editRoles"), card("helper")))
		await click(button(t("users.saveRoles"), dialog()))

		expect(dialog().textContent).toContain(t("problems.permission-exceeds-own"))
	})

	test("does not warn the admin or an operator editing someone else", async () => {
		roles = [{ id: "managers", name: "Managers", permissions: ["roles:manage"], memberCount: 1 }]
		users = [user("me", { roles: [{ id: "managers", name: "Managers" }], permissions: EVERYTHING })]
		await renderPage()
		await click(button(t("users.editRoles"), card("me")))
		await click(checkbox("Managers"))
		expect(dialog().textContent).not.toContain(t("users.lockoutWarning"))
		await click(button(t("users.cancel"), dialog()))

		myPermissions = ["users:read", "roles:manage"]
		users = [user("helper", { roles: [{ id: "managers", name: "Managers" }] })]
		await act(() => queryClient.refetchQueries())
		await settle()
		await click(button(t("users.editRoles"), card("helper")))
		await click(checkbox("Managers"))
		expect(dialog().textContent).not.toContain(t("users.lockoutWarning"))
	})
})
