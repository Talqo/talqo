import { expect } from "@playwright/test"

import { test } from "./application"
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
			await page.getByRole("tab", { name: "Roles", exact: true }).click()
			await page.getByRole("button", { name: "Create role" }).click()
			await expect(page).toHaveURL(/\/dashboard\/users\/roles\/[^/]+$/)
			createdRoleId = new URL(page.url()).pathname.split("/").pop()
			await page.getByLabel("Name").fill(roleName)
			await page.getByRole("button", { name: "Save changes" }).click()
			await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible()
			await expect(
				await page.request.put(`/api/agents/${agent.id}/access/${createdRoleId}`, {
					data: { permissions: ["agents:manage"] },
				}),
			).toBeOK()
			await page.reload()
			await expect(page.getByLabel("Name")).toHaveValue(roleName)
			await page.setViewportSize({ width: 390, height: 844 })
			await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
			await expect(page.getByRole("heading", { name: roleName, exact: true })).toBeVisible()
			await page.setViewportSize({ width: 1280, height: 800 })
			await page.getByRole("link", { name: "Back to roles" }).click()
			await expect(page.locator("[data-role-id]", { hasText: roleName })).toContainText("People with this role: 0")
		})

		await test.step("an invited operator starts without access", async () => {
			await logOut(page)
			await logIn(page, operator)
			await expect(page).toHaveURL("/dashboard/account")
			await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
			await logOut(page)
		})

		await test.step("the admin assigns the role on the Users page", async () => {
			await openDashboard(page, ADMIN, "/dashboard/users")
			const operatorCard = page.locator("[data-user-id]", { hasText: operator.username })
			await operatorCard.getByRole("button", { name: "Edit roles" }).click()
			const dialog = page.getByRole("dialog")
			await expect(dialog.getByRole("checkbox", { name: "Support", exact: true })).toBeVisible()
			await page.setViewportSize({ width: 390, height: 844 })
			await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
			await dialog.getByRole("checkbox", { name: "Support", exact: true }).check()
			await dialog.getByRole("checkbox", { name: roleName, exact: true }).check()
			await dialog.getByRole("button", { name: "Save roles" }).click()
			await expect(dialog).toBeHidden()
			await expect(operatorCard).toContainText(roleName)
			await expect(operatorCard).toContainText("Support")
			await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
			await page.setViewportSize({ width: 1280, height: 800 })
			await logOut(page)
		})

		await test.step("the operator can manage agents but nothing else", async () => {
			await openDashboard(page, operator)
			await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()
			await expect(page.getByRole("link", { name: "AI configuration", exact: true })).toHaveCount(0)
			await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0)

			await page.getByRole("link", { name: "Agents", exact: true }).click()
			await expect(page.getByRole("button", { name: "Create agent" })).toHaveCount(0)
			await page.getByRole("link", { name: new RegExp(agent.name) }).click()
			await expect(page.getByLabel("System prompt")).toBeEnabled()
			await expect(page.getByRole("button", { name: "Delete agent", exact: true })).toHaveCount(0)

			// A hidden link is not the boundary: the page itself must refuse.
			await page.goto("/dashboard/users/roles")
			await expect(page).toHaveURL("/dashboard")
			await expect(page.getByRole("button", { name: "Create role" })).toHaveCount(0)
			await logOut(page)
		})

		await test.step("the admin removes the operator and the role", async () => {
			await openDashboard(page, ADMIN, "/dashboard/users")
			const operatorCard = page.locator("[data-user-id]", { hasText: operator.username })
			await operatorCard.getByRole("button", { name: "Delete", exact: true }).click()
			const deleteUser = page.getByRole("dialog")
			await deleteUser.getByRole("button", { name: "Delete user", exact: true }).click()
			await expect(operatorCard).toHaveCount(0)

			await page.getByRole("tab", { name: "Roles", exact: true }).click()
			const roleCard = page.locator("[data-role-id]", { hasText: roleName })
			await roleCard.click()
			await page.getByRole("button", { name: "Delete role", exact: true }).click()
			await page.getByRole("dialog").getByRole("button", { name: "Delete role" }).click()
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
