import { expect, type Page, test } from "@playwright/test"
import assert from "node:assert/strict"

import { logIn } from "./log-in"

const ADMIN = { username: "admin", password: "admin123" }

async function logOut(page: Page) {
	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
}

// Disposable operator, so the journey never changes the shared seed accounts.
async function inviteOperator(page: Page, account: { password: string; username: string }) {
	await page.getByRole("link", { name: "Users", exact: true }).click()
	await page.getByRole("button", { name: "Invite a member" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await dialog.getByLabel("Invitation link:").inputValue()
	const token = new URL(inviteUrl).searchParams.get("token")
	if (!token) throw new Error(`Could not find an invitation token in URL: ${inviteUrl}`)
	// The dialog is modal, so close it before reaching the header controls.
	await page.keyboard.press("Escape")
	await logOut(page)

	await page.goto(`/accept-invite?token=${token}`)
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByLabel("Confirm password").fill(account.password)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/dashboard/account")
}

test("an admin gives an invited operator a role and the dashboard follows it", async ({ page }) => {
	const roleName = `Editors${Date.now()}`.padEnd(64, "a")
	const operator = { username: `operator_${Date.now()}`, password: "operator-role-password" }

	await test.step("the admin creates a role that can manage agents", async () => {
		await logIn(page, ADMIN)
		await expect(page.getByRole("link", { name: "Roles", exact: true })).toHaveCount(0)
		await page.getByRole("link", { name: "Users", exact: true }).click()
		await page.getByRole("tab", { name: "Roles", exact: true }).click()
		await expect(page.getByRole("link", { name: "Support People with this role: 0", exact: true })).toBeVisible()
		await page.getByRole("button", { name: "Create role" }).click()
		await expect(page).toHaveURL(/\/dashboard\/users\/roles\/[^/]+$/)
		await expect(page.getByRole("dialog")).toHaveCount(0)
		await expect(page.getByLabel("Name")).toHaveValue(/^New role(?: \d+)?$/)
		await page.getByLabel("Name").fill(roleName)
		await page.getByRole("button", { name: "Save changes" }).click()
		await expect(page.getByText("Changes saved.", { exact: true })).toBeVisible()
		const roleId = new URL(page.url()).pathname.split("/").pop()
		assert.ok(roleId, "Missing role ID")
		const { agents } = (await (await page.request.get("/api/agents")).json()) as {
			agents: { id: string; name: string }[]
		}
		const agent = agents.find(({ name }) => name === "Website Assistant")
		assert.ok(agent, "Missing seeded agent")
		await expect(
			await page.request.put(`/api/agents/${agent.id}/access/${roleId}`, { data: { permissions: ["agents:manage"] } }),
		).toBeOK()
		await page.reload()
		await expect(page.getByLabel("Name")).toHaveValue(roleName)
		await page.setViewportSize({ width: 390, height: 844 })
		await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
		await expect(page.getByRole("heading", { name: roleName, exact: true })).toHaveAttribute("title", roleName)
		await page.setViewportSize({ width: 1280, height: 800 })
		await page.getByRole("link", { name: "Back to roles" }).click()
		await expect(page.locator("[data-role-id]", { hasText: roleName })).toContainText("People with this role: 0")
		await expect(page.locator("[data-role-id]", { hasText: roleName })).not.toContainText("Manage agents")
	})

	await test.step("an invited operator starts without access", async () => {
		await inviteOperator(page, operator)
		await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
		await logOut(page)
	})

	await test.step("the admin assigns the role on the Users page", async () => {
		await logIn(page, ADMIN)
		await page.getByRole("link", { name: "Users", exact: true }).click()
		const operatorCard = page.locator("[data-user-id]", { hasText: operator.username })
		await operatorCard.getByRole("button", { name: "Edit roles" }).click()
		const dialog = page.getByRole("dialog")
		await expect(dialog.getByRole("checkbox", { name: "Support", exact: true })).toBeVisible()
		await page.setViewportSize({ width: 390, height: 844 })
		await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
		await expect(dialog.getByText("Manage agents", { exact: true })).toHaveCount(0)
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
		await logIn(page, operator)
		await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()
		await expect(page.getByRole("link", { name: "AI configuration", exact: true })).toHaveCount(0)
		await expect(page.getByRole("link", { name: "Roles", exact: true })).toHaveCount(0)
		await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0)

		await page.getByRole("link", { name: "Agents", exact: true }).click()
		await expect(page.getByRole("button", { name: "Create agent" })).toHaveCount(0)
		await page.getByRole("link", { name: /Website Assistant/ }).click()
		await expect(page.getByLabel("System prompt")).toBeEnabled()
		await expect(page.getByRole("button", { name: "Delete agent", exact: true })).toHaveCount(0)

		// A hidden link is not the boundary: the page itself must refuse.
		await page.goto("/dashboard/users/roles")
		await expect(page).toHaveURL("/dashboard")
		await expect(page.getByRole("button", { name: "Create role" })).toHaveCount(0)
		await logOut(page)
	})

	await test.step("the admin removes the operator and the role", async () => {
		await logIn(page, ADMIN)
		await page.getByRole("link", { name: "Users", exact: true }).click()
		const operatorCard = page.locator("[data-user-id]", { hasText: operator.username })
		await operatorCard.getByRole("button", { name: "Delete", exact: true }).click()
		const deleteUser = page.getByRole("dialog")
		await expect(deleteUser.getByRole("textbox")).toHaveCount(0)
		await deleteUser.getByRole("button", { name: "Delete user", exact: true }).click()
		await expect(operatorCard).toHaveCount(0)

		await page.getByRole("tab", { name: "Roles", exact: true }).click()
		const roleCard = page.locator("[data-role-id]", { hasText: roleName })
		await roleCard.click()
		await page.getByRole("button", { name: "Delete role", exact: true }).click()
		await page.getByRole("dialog").getByRole("button", { name: "Delete role" }).click()
		await expect(page).toHaveURL("/dashboard/users/roles")
		await expect(roleCard).toHaveCount(0)
	})
})
