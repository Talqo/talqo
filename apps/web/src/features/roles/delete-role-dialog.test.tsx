import type { Role } from "@/api/generated/models/role.zod"

import { json } from "@/testing/api-responses"
import { createTestHarness, type QueryClient, type Root } from "@/testing/component-harness"
import { click, findButton as button } from "@/testing/dom"
import { renderRouter } from "@/testing/router"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

const { DeleteRoleDialog } = await import("./delete-role-dialog")
const { getListRolesQueryKey } = await import("@/api/generated/roles/roles")
const { createRouter, createRootRoute, createRoute, createMemoryHistory, Outlet } =
	await import("@tanstack/react-router")
const { t } = await import("i18next")

let harness: ReturnType<typeof createTestHarness>
let host: HTMLDivElement
let root: Root
let queryClient: InstanceType<typeof QueryClient>
let deleteResponse: Response
let requests: { method: string; url: string }[]
let router: ReturnType<typeof makeRouter>

function makeRouter(role: Role, locksOut: boolean, disabled: boolean) {
	const rootRoute = createRootRoute({ component: () => <Outlet /> })
	const list = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/team/roles",
		component: () => <p data-testid="role-list" />,
	})
	const detail = createRoute({
		getParentRoute: () => rootRoute,
		path: "/dashboard/team/roles/$roleId",
		component: () => <DeleteRoleDialog role={role} locksOut={locksOut} disabled={disabled} />,
	})
	return createRouter({
		routeTree: rootRoute.addChildren([list, detail]),
		history: createMemoryHistory({ initialEntries: [`/dashboard/team/roles/${role.id}`] }),
	})
}

async function renderDialog(role: Role, locksOut = false, disabled = false) {
	router = makeRouter(role, locksOut, disabled)
	await renderRouter(root, queryClient, router)
}

function dialog(): HTMLElement {
	const found = document.querySelector<HTMLElement>("[role='alertdialog']")
	if (!found) throw new Error("confirmation not rendered")
	return found
}

async function openAndConfirm() {
	await click(button(t("roles.delete"), host))
	await click(button(t("roles.deleteConfirm"), dialog()))
}

function roleFixture(overrides: Partial<Role> = {}): Role {
	return { id: "support", name: "Support", permissions: [], memberCount: 0, ...overrides }
}

beforeEach(() => {
	deleteResponse = new Response(null, { status: 204 })
	requests = []
	harness = createTestHarness({
		fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
			requests.push({ method: init?.method ?? "GET", url })
			return deleteResponse
		}) as typeof fetch,
	})
	;({ host, root, queryClient } = harness)
})

afterEach(async () => {
	await harness.dispose()
})

describe("DeleteRoleDialog", () => {
	test("keeps the Default role undeletable and explains why", async () => {
		await renderDialog(roleFixture({ id: "default", name: "Starting access" }))

		const remove = button(t("roles.delete"), host)
		expect(remove.disabled).toBe(true)
		expect(remove.getAttribute("aria-describedby")).toBe("default-delete-description")
		expect(host.textContent).toContain(t("problems.default-role-delete-not-allowed"))
		await click(remove)
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
	})

	test("deletes an unused role, explains recovery, and returns to the list", async () => {
		queryClient.setQueryData(getListRolesQueryKey(), { roles: [], manageableRoleIds: [] })
		await renderDialog(roleFixture())

		await click(button(t("roles.delete"), host))
		const copy = dialog()
		expect(copy.textContent).toContain(t("roles.deleteDescriptionUnused"))
		expect(copy.textContent).toContain(t("roles.deleteRecoveryUnused"))

		await click(button(t("roles.deleteConfirm"), copy))

		expect(requests).toEqual([{ method: "DELETE", url: "/api/roles/support" }])
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		expect(queryClient.getQueryState(getListRolesQueryKey())?.isInvalidated).toBe(true)
		expect(router.state.location.pathname).toBe("/dashboard/team/roles")
	})

	test("treats a role deleted elsewhere as already removed", async () => {
		deleteResponse = json({ code: "role-not-found", type: "https://docs.talqo.chat/problems#role-not-found" }, 404)
		await renderDialog(roleFixture())

		await openAndConfirm()

		expect(requests).toEqual([{ method: "DELETE", url: "/api/roles/support" }])
		expect(document.querySelector("[role='alertdialog']")).toBeNull()
		expect(router.state.location.pathname).toBe("/dashboard/team/roles")
	})

	test("shows a failed deletion in the dialog and clears it when cancelled", async () => {
		deleteResponse = json(
			{
				code: "default-role-delete-not-allowed",
				type: "https://docs.talqo.chat/problems#default-role-delete-not-allowed",
			},
			409,
		)
		await renderDialog(roleFixture())

		await openAndConfirm()

		const copy = dialog()
		expect(copy.querySelector("[role='alert']")?.textContent).toBe(t("problems.default-role-delete-not-allowed"))
		expect(router.state.location.pathname).toBe("/dashboard/team/roles/support")

		await click(button(t("roles.cancel"), copy))
		expect(document.querySelector("[role='alertdialog']")).toBeNull()

		await click(button(t("roles.delete"), host))
		expect(dialog().querySelector("[role='alert']")).toBeNull()
	})

	test("warns when the deleted role is the operator's only way to manage roles", async () => {
		await renderDialog(
			roleFixture({ id: "managers", name: "Managers", permissions: ["roles:manage"], memberCount: 2 }),
			true,
		)

		await click(button(t("roles.delete"), host))

		expect(dialog().querySelector("[role='alert']")?.textContent).toBe(t("roles.lockoutWarningDelete"))
		expect(dialog().textContent).toContain(t("roles.deleteDescription", { people: 2 }))
		expect(dialog().textContent).toContain(t("roles.deleteRecovery"))
	})

	test("disables deletion while another role action is pending", async () => {
		await renderDialog(roleFixture(), false, true)

		expect(button(t("roles.delete"), host).disabled).toBe(true)
		expect(host.textContent).not.toContain(t("problems.default-role-delete-not-allowed"))
	})
})
