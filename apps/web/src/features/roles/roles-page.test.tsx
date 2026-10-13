import type { Role } from "@/api/generated/models/role.zod"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

// Component test files share one process, so only the first one registers the DOM.
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { RolesPage } = await import("./roles-page")
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query")
const { createRouter, createRootRoute, createMemoryHistory, RouterContextProvider } =
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
let usersResponse: Promise<Response> | undefined
let rolesFailure: Response | undefined
let requests: { body: unknown; method: string; url: string }[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() })

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
	if (url === "/api/roles" && method === "GET") return rolesFailure ?? json({ roles })
	if (url === "/api/roles" && method === "POST") {
		if (createFailure) return createFailure
		const body = JSON.parse(String(init?.body)) as Pick<Role, "name" | "permissions">
		return json({ role: { id: "new-role", memberCount: 0, ...body } }, 201)
	}
	if (url.startsWith("/api/roles/") && method === "DELETE") return new Response(null, { status: 204 })
	if (url.startsWith("/api/roles/") && method === "PUT") {
		const body = JSON.parse(String(init?.body)) as Pick<Role, "name" | "permissions">
		return json({ role: { id: url.slice("/api/roles/".length), memberCount: 0, ...body } })
	}
	throw new Error(`unexpected request ${method} ${url}`)
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
					<RolesPage />
				</QueryClientProvider>
			</RouterContextProvider>,
		),
	)
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
}

function permissionSwitch(label: string): HTMLButtonElement {
	const labelElement = [...document.querySelectorAll("label")].find((element) => element.textContent?.trim() === label)
	const input = labelElement ? document.getElementById(labelElement.htmlFor) : null
	if (!(input instanceof HTMLButtonElement)) throw new Error(`switch "${label}" not rendered`)
	return input
}

async function type(element: HTMLInputElement, text: string) {
	await act(async () => {
		const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
		valueSetter?.call(element, text)
		element.dispatchEvent(new Event("input", { bubbles: true }))
	})
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
	usersResponse = undefined
	rolesFailure = undefined
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

describe("RolesPage", () => {
	test("waits for the operator's roles before allowing changes that may lock them out", async () => {
		myPermissions = ["roles:manage", "users:read"]
		roles = [{ id: "managers", name: "Managers", permissions: ["roles:manage"], memberCount: 1 }]
		const deferred = Promise.withResolvers<Response>()
		usersResponse = deferred.promise
		await renderPage()
		expect(queryButton(t("roles.create"), host)).toBeUndefined()
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

	test("shows access restricted and refreshes permissions when the roles request is forbidden", async () => {
		rolesFailure = json({ code: "permission-denied", type: "https://docs.talqo.chat/problems#permission-denied" }, 403)
		await renderPage()
		await settle()
		expect(host.textContent).toContain(t("permissions.accessDeniedTitle"))
		expect(queryButton(t("roles.create"), host)).toBeUndefined()
		expect(requests.filter(({ url }) => url === "/api/me/permissions").length).toBeGreaterThan(1)
	})
	test("shows a permission included with a checked one as checked and unavailable", async () => {
		await renderPage()
		await click(button(t("roles.create")))

		await click(permissionSwitch(t("roles.permissionLabels.agentsManage")))

		const included = permissionSwitch(t("roles.permissionLabels.agentsRead"))
		expect(included.getAttribute("aria-checked")).toBe("true")
		expect(included.disabled).toBe(true)
		expect(dialog().textContent).toContain(
			t("roles.includedWith", { permission: t("roles.permissionLabels.agentsManage") }),
		)
	})

	test("disables permissions the operator lacks and says why", async () => {
		myPermissions = ["roles:manage", "users:read", "agents:read"]
		await renderPage()
		await click(button(t("roles.create")))

		expect(permissionSwitch(t("roles.permissionLabels.aiProviderManage")).disabled).toBe(true)
		expect(permissionSwitch(t("roles.permissionLabels.agentsRead")).disabled).toBe(false)
		expect(dialog().textContent).toContain(t("roles.notYours"))
	})

	test("saves the selected permissions and lets the server normalize them", async () => {
		await renderPage()
		await click(button(t("roles.create")))

		await type(dialog().querySelector<HTMLInputElement>("input[type='text']") as HTMLInputElement, "Support")
		await click(permissionSwitch(t("roles.permissionLabels.agentsRead")))
		await click(permissionSwitch(t("roles.permissionLabels.agentsManage")))
		await act(async () =>
			dialog()
				.querySelector("form")
				?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
		)
		await settle()

		expect(requests.find(({ method, url }) => method === "POST" && url === "/api/roles")?.body).toEqual({
			name: "Support",
			permissions: ["agents:read", "agents:manage"],
		})
	})

	test("offers no changes to a role that includes access the operator lacks", async () => {
		myPermissions = ["roles:manage", "users:read", "agents:read"]
		roles = [
			{ id: "ai", name: "AI team", permissions: ["ai_provider:manage"], memberCount: 1 },
			{ id: "readers", name: "Readers", permissions: ["agents:read"], memberCount: 0 },
		]
		await renderPage()

		const [aiCard, readersCard] = [...host.querySelectorAll("[data-role-id]")]
		expect(aiCard?.textContent).toContain(t("roles.cannotChange"))
		expect(queryButton(t("roles.edit"), aiCard)).toBeUndefined()
		expect(queryButton(t("roles.delete"), aiCard)).toBeUndefined()
		expect(queryButton(t("roles.edit"), readersCard)).toBeDefined()
	})

	test("confirms deletion in plain language with the way back", async () => {
		roles = [{ id: "support", name: "Support", permissions: ["agents:read"], memberCount: 3 }]
		await renderPage()

		await click(button(t("roles.delete"), host))

		expect(dialog().textContent).toContain(t("roles.deleteDescription", { people: 3 }))
		expect(dialog().textContent).toContain(t("roles.deleteRecovery"))
		await click(button(t("roles.deleteConfirm"), dialog()))
		expect(requests.some(({ method, url }) => method === "DELETE" && url === "/api/roles/support")).toBe(true)
	})

	test("opens the edit form with the role's current values after it changed elsewhere", async () => {
		roles = [{ id: "support", name: "Support", permissions: ["agents:read"], memberCount: 0 }]
		await renderPage()
		roles = [{ id: "support", name: "Helpdesk", permissions: ["agents:manage"], memberCount: 0 }]
		await act(() => queryClient.refetchQueries())
		await settle()

		await click(button(t("roles.edit"), host))

		expect(dialog().querySelector<HTMLInputElement>("input[type='text']")?.value).toBe("Helpdesk")
		expect(permissionSwitch(t("roles.permissionLabels.agentsManage")).getAttribute("aria-checked")).toBe("true")
		await act(async () =>
			dialog()
				.querySelector("form")
				?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
		)
		await settle()
		expect(requests.find(({ method }) => method === "PUT")?.body).toEqual({
			name: "Helpdesk",
			permissions: ["agents:manage"],
		})
	})

	test("shows the server's reason when saving fails and keeps the dialog open", async () => {
		createFailure = json({ code: "role-name-taken", type: "https://docs.talqo.chat/problems#role-name-taken" }, 409)
		await renderPage()
		await click(button(t("roles.create")))

		await type(dialog().querySelector<HTMLInputElement>("input[type='text']") as HTMLInputElement, "Support")
		await act(async () =>
			dialog()
				.querySelector("form")
				?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
		)
		await settle()

		expect(dialog().textContent).toContain(t("problems.role-name-taken"))
	})

	test("warns before an operator removes their only way to manage roles", async () => {
		myPermissions = ["roles:manage", "users:read"]
		myRoleIds = ["managers"]
		roles = [{ id: "managers", name: "Managers", permissions: ["roles:manage"], memberCount: 1 }]
		await renderPage()

		await click(button(t("roles.delete"), host))
		expect(dialog().textContent).toContain(t("roles.lockoutWarningDelete"))
		await click(button(t("roles.cancel"), dialog()))

		await click(button(t("roles.edit"), host))
		expect(dialog().textContent).not.toContain(t("roles.lockoutWarningEdit"))
		await click(permissionSwitch(t("roles.permissionLabels.rolesManage")))
		expect(dialog().textContent).toContain(t("roles.lockoutWarningEdit"))
	})
})
