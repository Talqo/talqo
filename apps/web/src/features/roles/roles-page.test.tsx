import type { Role } from "@/api/generated/models/role.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { RolesPage } = await import("./roles-page")
const { RolePage } = await import("./role-page")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRouter, createRootRoute, createRoute, createMemoryHistory, RouterProvider } =
	await import("@tanstack/react-router")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")
const { t } = await import("i18next")

const GRANTABLE = [
	{ permission: "users:read", implies: [] },
	{ permission: "users:manage", implies: ["users:read"] },
	{ permission: "roles:manage", implies: ["users:read"] },
	{ permission: "ai_provider:manage", implies: [] },
	{ permission: "agents:read", implies: [] },
	{ permission: "agents:manage", implies: ["agents:read"] },
]
const EVERYTHING = ["admin", ...GRANTABLE.map(({ permission }) => permission)]
const ME = { id: "me", username: "operator", mustChangePassword: false }

let myPermissions: string[]
let myRoleIds: string[]
let roles: Role[]
let createFailure: Response | undefined
let updateFailure: Response | undefined
let usersResponse: Promise<Response> | undefined
let rolesFailure: Response | undefined
let refreshedRolesResponse: Promise<Response> | undefined
let requests: { body: unknown; method: string; url: string }[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let router: ReturnType<typeof makeRouter>

function makeRouter(path: string) {
	const rootRoute = createRootRoute()
	const list = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard/users/roles", component: RolesPage })
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/users/roles/$roleId",
		component: () => <RolePage roleId={detail.useParams().roleId} />,
	})
	return createRouter({
		routeTree: rootRoute.addChildren([list, detail]),
		history: createMemoryHistory({ initialEntries: [path] }),
	})
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const url = String(input)
	const method = init?.method ?? "GET"
	requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
	if (url === "/api/me/permissions") return json({ permissions: myPermissions })
	if (url === "/api/auth/session") return json({ user: ME })
	if (url === "/api/users") {
		if (usersResponse) return usersResponse
		const ownRoles = roles.filter(({ id }) => myRoleIds.includes(id)).map(({ id, name }) => ({ id, name }))
		return json({ users: [{ ...ME, roles: ownRoles, isAdmin: myPermissions.includes("admin"), canManage: true }] })
	}
	if (url === "/api/permissions") return json({ permissions: GRANTABLE })
	if (url === "/api/roles" && method === "GET") return refreshedRolesResponse ?? rolesFailure ?? json({ roles })
	if (url === "/api/roles" && method === "POST") {
		if (createFailure) return createFailure
		const body = JSON.parse(String(init?.body)) as Pick<Role, "name" | "permissions">
		const role = { id: "new-role", memberCount: 0, ...body }
		roles.push(role)
		return json({ role }, 201)
	}
	const id = url.slice("/api/roles/".length)
	if (url.startsWith("/api/roles/") && method === "DELETE") {
		roles = roles.filter((role) => role.id !== id)
		return new Response(null, { status: 204 })
	}
	if (url.startsWith("/api/roles/") && method === "PUT") {
		if (updateFailure) return updateFailure
		const body = JSON.parse(String(init?.body)) as Pick<Role, "name" | "permissions">
		const role = { id, memberCount: 0, ...body }
		roles = roles.map((current) => (current.id === id ? role : current))
		return json({ role })
	}
	throw new Error(`unexpected request ${method} ${url}`)
}

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0))
	})
}

async function renderPage(roleId?: string) {
	router = makeRouter(roleId ? `/dashboard/users/roles/${roleId}` : "/dashboard/users/roles")
	await act(async () => {
		await router.load()
		root.render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		)
	})
	await settle()
	await settle()
}

function button(name: string, scope: ParentNode = document): HTMLButtonElement {
	const found = [...scope.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)
	if (!found) throw new Error(`button "${name}" not rendered`)
	return found
}

function queryButton(name: string, scope: ParentNode = document): HTMLButtonElement | undefined {
	return [...scope.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)
}

async function click(element: HTMLElement) {
	await act(async () => element.click())
	await settle()
	await settle()
}

function permissionSwitch(label: string): HTMLButtonElement {
	const labelElement = [...document.querySelectorAll("label")].find((element) => element.textContent?.trim() === label)
	const input = labelElement ? document.getElementById(labelElement.htmlFor) : null
	if (!(input instanceof HTMLButtonElement)) throw new Error(`switch "${label}" not rendered`)
	return input
}

function nameInput(): HTMLInputElement {
	const input = host.querySelector<HTMLInputElement>("input[type='text']")
	if (!input) throw new Error("name field not rendered")
	return input
}

async function type(element: HTMLInputElement, text: string) {
	await act(async () => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, text)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
}

async function save() {
	await act(async () =>
		host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
	)
	await settle()
	await settle()
}

function dialog(): HTMLElement {
	const found = document.querySelector<HTMLElement>("[role='dialog']")
	if (!found) throw new Error("dialog not open")
	return found
}

beforeEach(() => {
	myPermissions = EVERYTHING
	myRoleIds = []
	roles = []
	createFailure = undefined
	updateFailure = undefined
	usersResponse = undefined
	rolesFailure = undefined
	refreshedRolesResponse = undefined
	requests = []
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
})

describe("role management", () => {
	test("creates a blank role immediately and opens its page without a dialog", async () => {
		await renderPage()
		await click(button(t("roles.create")))
		expect(requests.find(({ method, url }) => method === "POST" && url === "/api/roles")?.body).toEqual({
			name: "New role",
			permissions: [],
		})
		expect(router.state.location.pathname).toBe("/dashboard/users/roles/new-role")
		expect(nameInput().value).toBe("New role")
		expect(document.querySelector("[role='dialog']")).toBeNull()
	})

	test("chooses a free default name and lists names and people without permission summaries", async () => {
		roles = [{ id: "existing", name: "NEW ROLE", permissions: ["agents:manage"], memberCount: 3 }]
		await renderPage()
		expect(host.textContent).toContain(t("roles.members", { people: 3 }))
		expect(host.textContent).not.toContain(t("roles.permissionLabels.agentsManage"))
		await click(button(t("roles.create")))
		expect(nameInput().value).toBe("New role 2")
	})

	test("opens a role by clicking its row", async () => {
		roles = [{ id: "support", name: "Support", permissions: ["agents:read"], memberCount: 0 }]
		await renderPage()
		const row = host.querySelector<HTMLElement>("[data-role-id='support']")
		if (!row) throw new Error("role link not rendered")
		await click(row)
		expect(nameInput().value).toBe("Support")
		expect(document.querySelector("[role='dialog']")).toBeNull()
	})

	test("shows creation errors without navigating away", async () => {
		createFailure = json({ code: "role-name-taken", type: "https://docs.talqo.chat/problems#role-name-taken" }, 409)
		await renderPage()
		await click(button(t("roles.create")))
		expect(host.textContent).toContain(t("problems.role-name-taken"))
		expect(router.state.location.pathname).toBe("/dashboard/users/roles")
	})

	test("shows access restricted and refreshes permissions when the roles request is forbidden", async () => {
		rolesFailure = json({ code: "permission-denied", type: "https://docs.talqo.chat/problems#permission-denied" }, 403)
		await renderPage()
		expect(host.textContent).toContain(t("permissions.accessDeniedTitle"))
		expect(queryButton(t("roles.create"), host)).toBeUndefined()
	})

	test("waits for the operator roles before offering changes that may lock them out", async () => {
		myPermissions = ["roles:manage", "users:read"]
		myRoleIds = ["managers"]
		roles = [{ id: "managers", name: "Managers", permissions: ["roles:manage"], memberCount: 1 }]
		const deferred = Promise.withResolvers<Response>()
		usersResponse = deferred.promise
		await renderPage("managers")
		expect(queryButton(t("roles.delete"), host)).toBeUndefined()
		await act(async () =>
			deferred.resolve(
				json({ users: [{ ...ME, roles: [{ id: "managers", name: "Managers" }], isAdmin: false, canManage: false }] }),
			),
		)
		await settle()
		await click(button(t("roles.delete"), host))
		expect(dialog().textContent).toContain(t("roles.lockoutWarningDelete"))
	})

	test("retries a failed roles load without reloading the page", async () => {
		rolesFailure = json({ code: "internal-server-error" }, 500)
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage()
		expect(host.querySelector("[data-role-id='support']")).toBeNull()
		rolesFailure = undefined
		await click(button(t("common.retry"), host))
		expect(host.querySelector("[data-role-id='support']")).not.toBeNull()
	})

	test("shows included switches and explains permissions the operator lacks", async () => {
		myPermissions = ["roles:manage", "users:read", "agents:read", "agents:manage"]
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		expect(permissionSwitch(t("roles.permissionLabels.aiProviderManage")).disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.notYours"))
		await click(permissionSwitch(t("roles.permissionLabels.agentsManage")))
		const included = permissionSwitch(t("roles.permissionLabels.agentsRead"))
		expect(included.getAttribute("aria-checked")).toBe("true")
		expect(included.disabled).toBe(true)
		expect(host.textContent).toContain(
			t("roles.includedWith", { permission: t("roles.permissionLabels.agentsManage") }),
		)
	})

	test("saves selected permissions and remains on the editable role page", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "Helpdesk")
		await click(permissionSwitch(t("roles.permissionLabels.agentsRead")))
		await click(permissionSwitch(t("roles.permissionLabels.agentsManage")))
		expect(host.textContent).toContain(t("roles.unsaved"))
		await save()
		expect(requests.find(({ method }) => method === "PUT")?.body).toEqual({
			name: "Helpdesk",
			permissions: ["agents:read", "agents:manage"],
		})
		expect(nameInput().value).toBe("Helpdesk")
		expect(host.textContent).toContain(t("roles.saved"))
		expect(button(t("roles.save"), host).disabled).toBe(true)
	})

	test("preserves unsaved changes on background refresh and can discard them", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "Draft")
		await act(() => queryClient.refetchQueries())
		await settle()
		expect(nameInput().value).toBe("Draft")
		await click(button(t("roles.discard"), host))
		expect(nameInput().value).toBe("Support")
		expect(button(t("roles.save"), host).disabled).toBe(true)
	})

	test("keeps the editor unavailable until saved access has refreshed", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "Helpdesk")
		const deferred = Promise.withResolvers<Response>()
		refreshedRolesResponse = deferred.promise
		await save()
		expect(nameInput().disabled).toBe(true)
		expect(button(t("roles.saving"), host).disabled).toBe(true)
		expect(button(t("roles.delete"), host).disabled).toBe(true)
		await act(async () =>
			deferred.resolve(json({ roles: [{ id: "support", name: "Helpdesk", permissions: [], memberCount: 0 }] })),
		)
		await settle()
		expect(nameInput().value).toBe("Helpdesk")
		expect(nameInput().disabled).toBe(false)
		expect(host.textContent).toContain(t("roles.saved"))
	})

	test("offers no changes to a role with access the operator lacks", async () => {
		myPermissions = ["roles:manage", "users:read", "agents:read"]
		roles = [{ id: "ai", name: "AI team", permissions: ["ai_provider:manage"], memberCount: 1 }]
		await renderPage("ai")
		expect(host.textContent).toContain(t("roles.cannotChange"))
		expect(nameInput().disabled).toBe(true)
		expect(queryButton(t("roles.save"), host)).toBeUndefined()
		expect(queryButton(t("roles.delete"), host)).toBeUndefined()
	})

	test("keeps an unfinished edit when leaving is cancelled", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "Draft")
		const confirm = spyOn(window, "confirm").mockReturnValue(false)
		await act(async () => {
			void router.navigate({ to: "/dashboard/users/roles" })
		})
		await settle()
		expect(confirm).toHaveBeenCalledWith(t("roles.leavePrompt"))
		expect(router.state.location.pathname).toBe("/dashboard/users/roles/support")
		expect(nameInput().value).toBe("Draft")
		confirm.mockReturnValue(true)
		await act(async () => {
			void router.navigate({ to: "/dashboard/users/roles" })
		})
		await settle()
		expect(router.state.location.pathname).toBe("/dashboard/users/roles")
	})

	test("confirms deletion with recovery instructions and returns to the role list", async () => {
		roles = [{ id: "support", name: "Support", permissions: ["agents:read"], memberCount: 3 }]
		await renderPage("support")
		await type(nameInput(), "Unsaved name")
		await click(button(t("roles.delete"), host))
		expect(dialog().textContent).toContain(t("roles.deleteDescription", { people: 3 }))
		expect(dialog().textContent).toContain(t("roles.deleteRecovery"))
		await click(button(t("roles.deleteConfirm"), dialog()))
		expect(router.state.location.pathname).toBe("/dashboard/users/roles")
		expect(host.querySelector("[data-role-id='support']")).toBeNull()
		expect(requests.some(({ method }) => method === "PUT")).toBe(false)
	})

	test("preserves the draft and displays the server reason when saving fails", async () => {
		updateFailure = json({ code: "role-name-taken", type: "https://docs.talqo.chat/problems#role-name-taken" }, 409)
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "Draft")
		await save()
		expect(nameInput().value).toBe("Draft")
		expect(host.textContent).toContain(t("problems.role-name-taken"))
	})

	test("warns before an operator removes their only way to manage roles", async () => {
		myPermissions = ["roles:manage", "users:read"]
		myRoleIds = ["managers"]
		roles = [{ id: "managers", name: "Managers", permissions: ["roles:manage"], memberCount: 1 }]
		await renderPage("managers")
		await click(permissionSwitch(t("roles.permissionLabels.rolesManage")))
		expect(host.textContent).toContain(t("roles.lockoutWarningEdit"))
	})

	test("explains a deleted or unknown role instead of showing an empty editor", async () => {
		await renderPage("missing")
		expect(host.textContent).toContain(t("problems.role-not-found"))
		expect(host.querySelector("form")).toBeNull()
	})
})
