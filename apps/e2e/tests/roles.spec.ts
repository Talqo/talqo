import { expect } from "@playwright/test"

import { test } from "./application"
import { web } from "./i18n"
import { createInvitedMember } from "./invited-member"
import { ADMIN, logIn, logOut, openDashboard } from "./log-in"

test("an admin gives an invited operator a role and the dashboard follows it", async ({ page, request, agent }) => {
	const roleName = `Editors${Date.now()}`.padEnd(64, "a")
	const operator = { username: crypto.randomUUID().replaceAll("-", ""), password: "operator-role-password" }
	let createdRoleId: string | undefined
	try {
		await createInvitedMember(request, operator)

		await test.step("the admin creates a role that can manage agents", async () => {
			await openDashboard(page, ADMIN, "/dashboard/users")
			await page.getByRole("link", { name: web("roles.heading"), exact: true }).click()
			await page.getByRole("button", { name: web("roles.create") }).click()
			await expect(page).toHaveURL(/\/dashboard\/users\/roles\/[^/]+$/)
			createdRoleId = new URL(page.url()).pathname.split("/").pop()
			await page.getByLabel(web("roles.name")).fill(roleName)
			await page.getByRole("button", { name: web("roles.save") }).click()
			await expect(page.getByText(web("roles.saved"), { exact: true })).toBeVisible()
			await expect(
				await page.request.put(`/api/roles/${createdRoleId}/agents/${agent.id}`, {
					data: { permissions: ["agents:manage"] },
				}),
			).toBeOK()
			await page.reload()
			await expect(page.getByLabel(web("roles.name"))).toHaveValue(roleName)
			await page.setViewportSize({ width: 390, height: 844 })
			await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
			await expect(page.getByRole("heading", { name: roleName, exact: true })).toBeVisible()
			await page.setViewportSize({ width: 1280, height: 800 })
			await page.getByRole("link", { name: web("roles.back") }).click()
			await expect(page.locator("[data-slot='card']", { hasText: roleName })).toContainText(
				web("roles.members", { people: 0 }),
			)
		})

		await test.step("an invited operator starts without access", async () => {
			await logOut(page)
			await logIn(page, operator)
			await expect(page).toHaveURL("/dashboard/account")
			await expect(page.getByRole("link", { name: web("nav.agents"), exact: true })).toHaveCount(0)
			await logOut(page)
		})

		await test.step("the admin assigns the role on the Team page", async () => {
			await openDashboard(page, ADMIN, "/dashboard/users")
			const operatorCard = page.locator("[data-user-id]", { hasText: operator.username })
			await operatorCard.getByRole("button", { name: web("users.editRoles") }).click()
			const dialog = page.getByRole("dialog")
			await expect(dialog.getByRole("checkbox", { name: "Support", exact: true })).toBeVisible()
			await page.setViewportSize({ width: 390, height: 844 })
			await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
			await dialog.getByRole("checkbox", { name: "Support", exact: true }).check()
			await dialog.getByRole("checkbox", { name: roleName, exact: true }).check()
			await dialog.getByRole("button", { name: web("users.saveRoles") }).click()
			await expect(dialog).toBeHidden()
			await expect(operatorCard).toContainText(roleName)
			await expect(operatorCard).toContainText("Support")
			await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
			await page.setViewportSize({ width: 1280, height: 800 })
			await logOut(page)
		})

		await test.step("the operator can manage agents but nothing else", async () => {
			await openDashboard(page, operator)
			await expect(page.getByRole("link", { name: web("nav.agents"), exact: true })).toBeVisible()
			await expect(page.getByRole("link", { name: web("nav.aiConfiguration"), exact: true })).toHaveCount(0)
			await expect(page.getByRole("link", { name: web("nav.team"), exact: true })).toHaveCount(0)

			await page.getByRole("link", { name: web("nav.agents"), exact: true }).click()
			await expect(page.getByRole("button", { name: web("agents.create") })).toHaveCount(0)
			await page.getByRole("link", { name: new RegExp(agent.name) }).click()
			await expect(page.getByLabel(web("agentFields.systemPrompt"))).toBeEnabled()
			await expect(page.getByRole("button", { name: web("agentConfig.deleteAgent"), exact: true })).toHaveCount(0)

			// A hidden link is not the boundary: the page itself must refuse.
			await page.goto("/dashboard/users/roles")
			await expect(page).toHaveURL("/dashboard")
			await expect(page.getByRole("button", { name: web("roles.create") })).toHaveCount(0)
			await logOut(page)
		})

		await test.step("the admin removes the operator and the role", async () => {
			await openDashboard(page, ADMIN, "/dashboard/users")
			const operatorCard = page.locator("[data-user-id]", { hasText: operator.username })
			await operatorCard.getByRole("button", { name: web("users.delete"), exact: true }).click()
			const deleteUser = page.getByRole("alertdialog")
			await deleteUser.getByRole("button", { name: web("users.deleteConfirm"), exact: true }).click()
			await expect(operatorCard).toHaveCount(0)

			await page.getByRole("link", { name: web("roles.heading"), exact: true }).click()
			const roleCard = page.locator("[data-slot='card']", { hasText: roleName })
			await roleCard.click()
			await page.getByRole("button", { name: web("roles.delete"), exact: true }).click()
			await page
				.getByRole("alertdialog")
				.getByRole("button", { name: web("roles.deleteConfirm") })
				.click()
			await expect(page).toHaveURL("/dashboard/users/roles")
			await expect(roleCard).toHaveCount(0)
			createdRoleId = undefined
		})
	} finally {
		await expect(await request.post("/api/auth/login", { data: ADMIN })).toBeOK()
		const response = await request.get("/api/users")
		await expect(response).toBeOK()
		const { users } = (await response.json()) as { users: { id: string; username: string }[] }
		const user = users.find(({ username }) => username === operator.username)
		// oxlint-disable-next-line playwright/no-conditional-in-test, playwright/no-conditional-expect -- The journey may already have deleted the user.
		if (user) await expect(await request.delete(`/api/users/${user.id}`)).toBeOK()
		// oxlint-disable-next-line playwright/no-conditional-in-test, playwright/no-conditional-expect -- Cleanup must handle failed creation and completed deletion.
		if (createdRoleId) await expect(await request.delete(`/api/roles/${createdRoleId}`)).toBeOK()
	}
})
