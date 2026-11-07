import type { Role } from "@/api/generated/models/role.zod"
import type { QueryClient } from "@/testing/component-harness"

import { createRoleBodyNameMax } from "@/api/generated/models/roles/createRoleBody.zod"
import { json, parseJsonBody, recordRequest } from "@/testing/api-responses"
import { act, createTestHarness, QueryClientProvider, type Root, settle } from "@/testing/component-harness"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { RolesPage } = await import("./roles-page")
const { RolePage } = await import("./role-page")
const { createRouter, createRootRoute, createRoute, createMemoryHistory, RouterProvider } =
	await import("@tanstack/react-router")
const { t } = await import("i18next")

const GRANTABLE = [
	{ permission: "users:read", implies: [] },
	{ permission: "users:manage", implies: ["users:read"] },
	{ permission: "roles:manage", implies: ["users:read"] },
	{ permission: "ai_provider:manage", implies: [] },
]
const EVERYTHING = ["admin", ...GRANTABLE.map(({ permission }) => permission)]
const ME = { id: "me", username: "operator", mustChangePassword: false }

type RoleAgent = { id: string; name: string; permissions: string[]; rolePermissions: string[] }

let myPermissions: string[]
let myRoleIds: string[]
let roles: Role[]
let roleAgents: Record<string, RoleAgent[]>
let createFailure: Response | undefined
let updateFailure: Response | undefined
let usersResponse: Promise<Response> | undefined
let rolesFailure: Response | undefined
let refreshedRolesResponse: Promise<Response> | undefined
let responseDelays: Record<string, Promise<void> | undefined>
let responseFailures: Record<string, Response | undefined>
let requests: { body: unknown; method: string; url: string }[]
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let router: ReturnType<typeof makeRouter>
let harness: ReturnType<typeof createTestHarness>

function makeRouter(path: string) {
	const rootRoute = createRootRoute()
	const list = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard/team/roles", component: RolesPage })
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/team/roles/$roleId",
		component: () => <RolePage roleId={detail.useParams().roleId} />,
	})
	return createRouter({
		routeTree: rootRoute.addChildren([list, detail]),
		history: createMemoryHistory({ initialEntries: [path] }),
	})
}

async function respond(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	const { url, method } = recordRequest(requests, input, init)
	const delay = responseDelays[url]
	const failure = responseFailures[url]
	if (method === "GET" && delay) await delay
	if (method === "GET" && failure) return failure
	if (url === "/api/me/permissions") return json({ permissions: myPermissions })
	if (url === "/api/auth/session") return json({ user: ME })
	if (url === "/api/users") {
		if (usersResponse) return usersResponse
		const ownRoles = roles.filter(({ id }) => myRoleIds.includes(id)).map(({ id, name }) => ({ id, name }))
		return json({ users: [{ ...ME, roles: ownRoles, permissions: myPermissions, canManage: true }] })
	}
	if (url === "/api/permissions") return json({ permissions: GRANTABLE })
	if (url === "/api/roles" && method === "GET")
		return refreshedRolesResponse ?? rolesFailure ?? json({ roles, manageableRoleIds: roles.map((role) => role.id) })
	if (url === "/api/roles" && method === "POST") {
		if (createFailure) return createFailure
		const body = parseJsonBody(init?.body) as Pick<Role, "name" | "permissions">
		const role = { id: "new-role", memberCount: 0, ...body }
		roles.push(role)
		return json({ role }, 201)
	}
	if (url.startsWith("/api/roles/") && url.endsWith("/agents")) {
		const roleId = url.slice("/api/roles/".length, -"/agents".length)
		return json({ agents: roleAgents[roleId] ?? [] })
	}
	const id = url.slice("/api/roles/".length)
	if (url.startsWith("/api/roles/") && method === "DELETE") {
		roles = roles.filter((role) => role.id !== id)
		return new Response(null, { status: 204 })
	}
	if (url.startsWith("/api/roles/") && method === "PUT") {
		if (updateFailure) return updateFailure
		const body = parseJsonBody(init?.body) as Pick<Role, "name" | "permissions">
		const role = { id, memberCount: 0, ...body }
		roles = roles.map((current) => (current.id === id ? role : current))
		return json({ role })
	}
	throw new Error(`unexpected request ${method} ${url}`)
}

async function renderPage(roleId?: string) {
	router = makeRouter(roleId ? `/dashboard/team/roles/${roleId}` : "/dashboard/team/roles")
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

function expectRoleControlsHidden() {
	expect(host.querySelector("form") === null).toBe(true)
	expect(host.textContent).not.toContain(t("agentAccess.title"))
	expect(queryButton(t("roles.delete"), host) === undefined).toBe(true)
}

function requestCount(url: string): number {
	return requests.filter((request) => request.url === url && request.method === "GET").length
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
	const found = document.querySelector<HTMLElement>("[role='alertdialog']")
	if (!found) throw new Error("dialog not open")
	return found
}

beforeEach(() => {
	myPermissions = EVERYTHING
	myRoleIds = []
	roles = []
	roleAgents = {}
	createFailure = undefined
	updateFailure = undefined
	usersResponse = undefined
	rolesFailure = undefined
	refreshedRolesResponse = undefined
	responseDelays = {}
	responseFailures = {}
	requests = []
	harness = createTestHarness({ fetch: respond as typeof fetch })
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("role management", () => {
	test("disables deletion of a renamed Default role while allowing name and permission edits", async () => {
		roles = [{ id: "default", name: "starting access", permissions: [], memberCount: 0 }]
		await renderPage("default")
		expect(button(t("roles.delete"), host).disabled).toBe(true)
		expect(host.textContent).toContain(t("problems.default-role-delete-not-allowed"))
		expect(nameInput().disabled).toBe(false)
		await type(nameInput(), "new starters")
		await click(permissionSwitch(t("roles.permissionLabels.aiProviderManage")))
		await save()
		expect(requests.find(({ method, url }) => method === "PUT" && url === "/api/roles/default")?.body).toEqual({
			name: "new starters",
			permissions: ["ai_provider:manage"],
		})
	})

	test("creates a blank role immediately and opens its page without a dialog", async () => {
		await renderPage()
		await click(button(t("roles.create")))
		expect(requests.find(({ method, url }) => method === "POST" && url === "/api/roles")?.body).toEqual({
			name: "New role",
			permissions: [],
		})
		expect(router.state.location.pathname).toBe("/dashboard/team/roles/new-role")
		expect(nameInput().value).toBe("New role")
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
	})

	test("chooses a free default name and lists names and people without permission summaries", async () => {
		roles = [{ id: "existing", name: "NEW ROLE", permissions: ["users:manage"], memberCount: 3 }]
		await renderPage()
		expect(host.textContent).toContain(t("roles.members", { people: 3 }))
		expect(host.textContent).not.toContain(t("roles.permissionLabels.usersManage"))
		await click(button(t("roles.create")))
		expect(nameInput().value).toBe("New role 2")
	})

	test("shows the role name as a heading and keeps long names fully available", async () => {
		const fullName = `Support ${"with-a-very-long-name-".repeat(8)}`
		roles = [{ id: "support", name: fullName, permissions: [], memberCount: 3 }]
		await renderPage()

		const link = host.querySelector<HTMLAnchorElement>("[data-role-id='support']")
		if (!link) throw new Error("role link not rendered")
		const card = link.closest<HTMLElement>("[data-slot='card']")
		const heading = card?.querySelector("[data-slot='card-title']")
		const label = heading?.querySelector("span")
		expect(heading?.tagName).toBe("H2")
		expect(heading?.textContent).toBe(fullName)
		expect(label?.getAttribute("title")).toBe(fullName)
		expect(card?.querySelectorAll("a, button, input, select, textarea, [tabindex]")).toHaveLength(1)
		await act(async () => link.focus())
		expect(document.activeElement === link).toBe(true)
	})

	test("opens a role by clicking its row", async () => {
		roles = [{ id: "support", name: "Support", permissions: ["users:read"], memberCount: 0 }]
		await renderPage()
		const row = host.querySelector<HTMLElement>("[data-role-id='support']")
		if (!row) throw new Error("role link not rendered")
		await click(row)
		expect(nameInput().value).toBe("Support")
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
	})

	test("shows creation errors without navigating away", async () => {
		createFailure = json({ code: "role-name-taken", type: "https://docs.talqo.chat/problems#role-name-taken" }, 409)
		await renderPage()
		await click(button(t("roles.create")))
		expect(host.textContent).toContain(t("problems.role-name-taken"))
		expect(router.state.location.pathname).toBe("/dashboard/team/roles")
	})

	test("hides creation until the roles list has loaded", async () => {
		const rolesResponse = Promise.withResolvers<void>()
		responseDelays["/api/roles"] = rolesResponse.promise
		await renderPage()
		expect(queryButton(t("roles.create"), host) === undefined).toBe(true)
		expect(host.querySelector("output")?.textContent).toBe(t("roles.loading"))
		await act(async () => rolesResponse.resolve())
		await settle()
		expect(queryButton(t("roles.create"), host) !== undefined).toBe(true)
	})

	test("shows access restricted and refreshes permissions when the roles request is forbidden", async () => {
		rolesFailure = json({ code: "permission-denied", type: "https://docs.talqo.chat/problems#permission-denied" }, 403)
		await renderPage()
		expect(host.textContent).toContain(t("permissions.accessDeniedTitle"))
		expect(queryButton(t("roles.create"), host) === undefined).toBe(true)
	})

	test("refreshes permissions when operator roles are forbidden on a role page", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		responseFailures["/api/users"] = json(
			{ code: "permission-denied", type: "https://docs.talqo.chat/problems#permission-denied" },
			403,
		)
		await renderPage("support")
		expect(host.textContent).toContain(t("permissions.accessDeniedTitle"))
		expectRoleControlsHidden()
		expect(requestCount("/api/me/permissions")).toBe(2)
	})

	test("hides a lingering creation error once access is denied", async () => {
		createFailure = json({ code: "role-name-taken", type: "https://docs.talqo.chat/problems#role-name-taken" }, 409)
		await renderPage()
		await click(button(t("roles.create")))
		expect(host.textContent).toContain(t("problems.role-name-taken"))
		rolesFailure = json({ code: "permission-denied", type: "https://docs.talqo.chat/problems#permission-denied" }, 403)
		await act(() => queryClient.refetchQueries())
		await settle()
		expect(host.textContent).toContain(t("permissions.accessDeniedTitle"))
		expect(host.textContent).not.toContain(t("problems.role-name-taken"))
		expect(queryButton(t("roles.create"), host) === undefined).toBe(true)
	})

	test("waits for the operator roles before offering changes that may lock them out", async () => {
		myPermissions = ["roles:manage", "users:read"]
		myRoleIds = ["managers"]
		roles = [
			{ id: "managers", name: "Managers", permissions: ["roles:manage"], memberCount: 1 },
			{ id: "other-managers", name: "Other managers", permissions: ["roles:manage"], memberCount: 1 },
		]
		const deferred = Promise.withResolvers<Response>()
		usersResponse = deferred.promise
		await renderPage("managers")
		expectRoleControlsHidden()
		expect(host.querySelector("output")?.textContent).toBe(t("roles.loading"))
		await act(async () =>
			deferred.resolve(
				json({
					users: [
						{
							id: "other-user",
							username: "colleague",
							mustChangePassword: false,
							roles: [{ id: "other-managers", name: "Other managers" }],
							permissions: myPermissions,
							canManage: false,
						},
						{ ...ME, roles: [{ id: "managers", name: "Managers" }], permissions: myPermissions, canManage: false },
					],
				}),
			),
		)
		await settle()
		await click(button(t("roles.delete"), host))
		expect(dialog().textContent).toContain(t("roles.lockoutWarningDelete"))
	})

	for (const [dependency, url] of [
		["role list", "/api/roles"],
		["permission catalog", "/api/permissions"],
		["operator permissions", "/api/me/permissions"],
		["session", "/api/auth/session"],
	] as const) {
		test(`hides role controls while the ${dependency} is pending`, async () => {
			roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
			const response = Promise.withResolvers<void>()
			responseDelays[url] = response.promise
			await renderPage("support")
			expectRoleControlsHidden()
			expect(host.querySelector("output")?.textContent).toBe(t("roles.loading"))
			await act(async () => response.resolve())
			await settle()
			expect(host.querySelector("form") !== null).toBe(true)
		})
	}

	test("keeps role controls hidden while retrying only the failed dependency", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		const failedUrl = "/api/permissions"
		responseFailures[failedUrl] = json({ code: "internal-server-error" }, 500)
		await act(() => queryClient.refetchQueries({ queryKey: [failedUrl] }))
		await settle()
		expectRoleControlsHidden()
		expect(requestCount(failedUrl)).toBe(2)

		responseFailures[failedUrl] = undefined
		const retryResponse = Promise.withResolvers<void>()
		responseDelays[failedUrl] = retryResponse.promise
		await click(button(t("common.retry"), host))
		expectRoleControlsHidden()
		expect(requestCount(failedUrl)).toBe(3)
		for (const url of [
			"/api/roles",
			"/api/me/permissions",
			"/api/users",
			"/api/auth/session",
			"/api/roles/support/agents",
		]) {
			expect(requestCount(url)).toBe(1)
		}

		await act(async () => retryResponse.resolve())
		await settle()
		expect(nameInput().disabled).toBe(false)
	})

	test("hides creation after a failed roles refresh and retries without reloading the page", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage()
		rolesFailure = json({ code: "internal-server-error" }, 500)
		await act(() => queryClient.refetchQueries())
		await settle()
		expect(host.querySelector("[data-role-id='support']") === null).toBe(true)
		expect(queryButton(t("roles.create"), host) === undefined).toBe(true)
		rolesFailure = undefined
		await click(button(t("common.retry"), host))
		expect(host.querySelector("[data-role-id='support']") !== null).toBe(true)
	})

	test("shows included switches and explains permissions the operator lacks", async () => {
		myPermissions = ["roles:manage", "users:read", "users:manage"]
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		expect(permissionSwitch(t("roles.permissionLabels.aiProviderManage")).disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.notYours"))
		await click(permissionSwitch(t("roles.permissionLabels.usersManage")))
		const included = permissionSwitch(t("roles.permissionLabels.usersRead"))
		expect(included.getAttribute("aria-checked")).toBe("true")
		expect(included.disabled).toBe(true)
		expect(host.textContent).toContain(t("roles.includedWith", { permission: t("roles.permissionLabels.usersManage") }))
	})

	test("saves selected permissions and remains on the editable role page", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "Helpdesk")
		await click(permissionSwitch(t("roles.permissionLabels.usersManage")))
		expect(host.textContent).toContain(t("roles.unsaved"))
		await save()
		expect(requests.find(({ method }) => method === "PUT")?.body).toEqual({
			name: "Helpdesk",
			permissions: ["users:manage"],
		})
		expect(nameInput().value).toBe("Helpdesk")
		expect(host.textContent).toContain(t("roles.saved"))
		expect(button(t("roles.save"), host).disabled).toBe(true)
	})

	test("lists the agents this role gives access to", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		roleAgents = {
			support: [
				{
					id: "agent-a",
					name: "Agent A",
					permissions: ["agents:read", "agents:manage"],
					rolePermissions: ["agents:manage"],
				},
				{
					id: "agent-b",
					name: "Agent B",
					permissions: ["agents:read", "stats:read"],
					rolePermissions: ["stats:read"],
				},
			],
		}
		await renderPage("support")
		expect(host.textContent).toContain("Agent A")
		expect(host.textContent).toContain(t("agentAccess.editConfiguration"))
		expect(host.textContent).toContain("Agent B")
	})

	test("explains when a role gives no agents access", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		roleAgents = {
			support: [{ id: "agent-a", name: "Agent A", permissions: ["agents:read"], rolePermissions: [] }],
		}
		await renderPage("support")
		expect(host.textContent).toContain(t("agentAccess.empty"))
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

	test("stops blocking navigation when the edited role disappears", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "Draft")
		roles = []
		await act(() => queryClient.refetchQueries())
		await settle()
		expect(host.textContent).toContain(t("problems.role-not-found"))
		await act(async () => {
			void router.navigate({ to: "/dashboard/team/roles" })
		})
		await settle()
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		expect(router.state.location.pathname).toBe("/dashboard/team/roles")
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
			deferred.resolve(
				json({
					roles: [{ id: "support", name: "Helpdesk", permissions: [], memberCount: 0 }],
					manageableRoleIds: ["support"],
				}),
			),
		)
		await settle()
		expect(nameInput().value).toBe("Helpdesk")
		expect(nameInput().disabled).toBe(false)
		expect(host.textContent).toContain(t("roles.saved"))
	})

	test("offers no changes to a role the operator cannot manage", async () => {
		myPermissions = ["roles:manage", "users:read"]
		roles = [
			{ id: "support", name: "Support", permissions: ["roles:manage"], memberCount: 0 },
			{ id: "manageable", name: "Manageable", permissions: [], memberCount: 0 },
		]
		refreshedRolesResponse = Promise.resolve(json({ roles, manageableRoleIds: ["manageable"] }))
		await renderPage("support")
		expect(host.textContent).toContain(t("roles.cannotChange"))
		expect(nameInput().disabled).toBe(true)
		expect(queryButton(t("roles.save"), host) === undefined).toBe(true)
		expect(queryButton(t("roles.delete"), host) === undefined).toBe(true)
	})

	test("offers no changes to a role with access the operator lacks", async () => {
		myPermissions = ["roles:manage", "users:read"]
		roles = [{ id: "ai", name: "AI team", permissions: ["ai_provider:manage"], memberCount: 1 }]
		await renderPage("ai")
		expect(host.textContent).toContain(t("roles.cannotChange"))
		expect(nameInput().disabled).toBe(true)
		expect(queryButton(t("roles.save"), host) === undefined).toBe(true)
		expect(queryButton(t("roles.delete"), host) === undefined).toBe(true)
	})

	test("leaves an untouched role without asking to discard changes", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await act(async () => {
			void router.navigate({ to: "/dashboard/team/roles" })
		})
		await settle()
		expect(document.querySelector("[role='alertdialog']") === null).toBe(true)
		expect(router.state.location.pathname).toBe("/dashboard/team/roles")
	})

	test("keeps an unfinished edit when leaving is cancelled", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "Draft")
		await act(async () => {
			void router.navigate({ to: "/dashboard/team/roles" })
		})
		await settle()
		expect(dialog().textContent).toContain(t("common.discardTitle"))
		await click(button(t("common.keepEditing"), dialog()))
		expect(router.state.location.pathname).toBe("/dashboard/team/roles/support")
		expect(nameInput().value).toBe("Draft")
		await act(async () => {
			void router.navigate({ to: "/dashboard/team/roles" })
		})
		await settle()
		await click(button(t("common.discardChanges"), dialog()))
		expect(router.state.location.pathname).toBe("/dashboard/team/roles")
	})

	test("moves deletion into a danger zone below the access settings", async () => {
		roles = [{ id: "support", name: "Support", permissions: ["users:read"], memberCount: 3 }]
		await renderPage("support")
		await type(nameInput(), "Unsaved name")
		const dangerZone = host.querySelector("section[aria-labelledby]")
		expect(dangerZone?.textContent).toContain(t("roles.dangerZone"))
		expect(dangerZone?.textContent).toContain(t("roles.delete"))
		expect(host.querySelector("form")?.textContent).not.toContain(t("roles.delete"))
		const accessCard = [...host.querySelectorAll("[data-slot='card']")].at(-1)
		expect(accessCard?.nextElementSibling).toBe(dangerZone)
		await click(button(t("roles.delete"), host))
		expect(dialog().textContent).toContain(t("roles.deleteDescription", { people: 3 }))
		expect(dialog().textContent).toContain(t("roles.deleteRecovery"))
		await click(button(t("roles.deleteConfirm"), dialog()))
		expect(router.state.location.pathname).toBe("/dashboard/team/roles")
		expect(host.querySelector("[data-role-id='support']") === null).toBe(true)
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

	test("keeps saving enabled for an invalid dirty form so submit reveals field errors", async () => {
		roles = [{ id: "support", name: "Support", permissions: [], memberCount: 0 }]
		await renderPage("support")
		await type(nameInput(), "")
		expect(button(t("roles.save"), host).disabled).toBe(false)
		await save()
		expect(host.textContent).toContain(t("roles.nameError", { max: createRoleBodyNameMax }))
		expect(requests.some(({ method }) => method === "PUT")).toBe(false)
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
		expect(host.querySelector("form") === null).toBe(true)
	})
})
