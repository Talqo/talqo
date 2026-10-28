import { expect } from "@playwright/test"
import assert from "node:assert/strict"

import { test } from "./application"
import { pinLanguage, web } from "./i18n"
import { createInvitedMember } from "./invited-member"
import { ADMIN, logIn, logInThroughApi } from "./log-in"

test("admin grants one agent's reporting access and removes it immediately", async ({
	page,
	browser,
	agent,
	application,
}) => {
	const account = { username: crypto.randomUUID().replaceAll("-", ""), password: "reporting-test-password" }
	await createInvitedMember(page.request, account)
	await logInThroughApi(page, ADMIN)
	const { users } = (await (await page.request.get("/api/users")).json()) as {
		users: { id: string; username: string; roles: { id: string }[] }[]
	}
	const user = users.find(({ username }) => username === account.username)
	assert.ok(user, "Missing invited operator")
	const name = `Reporting ${crypto.randomUUID()}`
	const created = await page.request.post("/api/roles", { data: { name, permissions: [] } })
	await expect(created).toBeOK()
	const { role } = (await created.json()) as { role: { id: string } }
	const context = await browser.newContext({ baseURL: application.origin })
	await pinLanguage(context)
	try {
		await expect(await page.request.put(`/api/users/${user.id}/roles`, { data: { roleIds: [role.id] } })).toBeOK()
		await page.goto(`/dashboard/agent/${agent.id}`)
		const access = page.locator("[data-slot=card]", {
			has: page.getByRole("heading", { name: web("agentAccess.title"), exact: true }),
		})
		const addRole = access.getByRole("combobox", { name: web("agentAccess.addRole"), exact: true })
		await addRole.focus()
		await addRole.press("ArrowDown")
		await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
		await page.keyboard.press("Escape")
		await expect(addRole).toBeFocused()
		await addRole.click()
		await page.getByRole("option", { name, exact: true }).click()
		await expect(page.getByRole("link", { name: web("agentAccess.statistics"), exact: true })).toHaveCount(0)
		await expect(page.getByRole("link", { name: web("agentAccess.conversations"), exact: true })).toHaveCount(0)
		await expect(access.getByRole("switch", { name: web("agentAccess.statistics"), exact: true })).toBeFocused()
		await access.getByRole("switch", { name: web("agentAccess.statistics"), exact: true }).check()
		await access.getByRole("switch", { name: web("agentAccess.conversations"), exact: true }).check()
		await page.getByRole("tab", { name: web("agentConfig.tabContext"), exact: true }).click()
		await expect(page.getByRole("tab", { name: web("agentConfig.tabContext"), exact: true })).toHaveAttribute(
			"aria-selected",
			"true",
		)
		await page.getByRole("tab", { name: web("agentConfig.tabConfiguration"), exact: true }).click()
		await expect(access.getByRole("switch", { name: web("agentAccess.statistics"), exact: true })).toBeChecked()
		await expect(access.getByRole("switch", { name: web("agentAccess.conversations"), exact: true })).toBeChecked()
		const beforeSave = await page.request.get(`/api/agents/${agent.id}/access`)
		const grants = (await beforeSave.json()) as { roles: { id: string; permissions: string[] }[] }
		expect(grants.roles.find((entry) => entry.id === role.id)?.permissions).toEqual([])
		await access.getByRole("button", { name: web("agentAccess.save"), exact: true }).click()
		await expect(access.getByRole("status")).toHaveText(web("agentAccess.saved"))

		const operator = await context.newPage()
		await logIn(operator, account)
		await expect(operator.getByRole("link", { name: web("nav.dashboard"), exact: true })).toBeVisible()
		await expect(operator.getByRole("link", { name: web("nav.conversations"), exact: true })).toBeVisible()
		await expect(operator.getByRole("link", { name: web("nav.agents"), exact: true })).toHaveCount(0)
		await operator.goto(`/dashboard/agent/${agent.id}`)
		await expect(operator).toHaveURL("/dashboard")
		await expect(operator.getByLabel(web("agentFields.systemPrompt"))).toHaveCount(0)
		await expect(operator.getByRole("heading", { name: web("agentAccess.title"), exact: true })).toHaveCount(0)
		await expect(operator.getByRole("button", { name: web("agentConfig.deleteAgent"), exact: true })).toHaveCount(0)
		await operator.getByRole("link", { name: web("nav.conversations"), exact: true }).click()
		await expect(operator).toHaveURL("/dashboard/conversations")

		await access.getByRole("switch", { name: web("agentAccess.deleteAgent"), exact: true }).check()
		await access.getByRole("button", { name: web("agentAccess.remove"), exact: true }).click()
		const confirmation = page.getByRole("dialog")
		await expect(confirmation).toContainText(name)
		await confirmation.getByRole("button", { name: web("common.cancel"), exact: true }).click()
		await expect(access.getByRole("button", { name, exact: true })).toBeVisible()
		await access.getByRole("button", { name: web("agentAccess.remove"), exact: true }).click()
		await confirmation.getByRole("button", { name: web("agentAccess.remove"), exact: true }).click()
		await expect(access.getByRole("button", { name, exact: true })).toHaveCount(0)
		await expect(addRole).toBeFocused()
		await operator.reload()
		await expect(operator).toHaveURL("/dashboard/account")
		await expect(operator.getByRole("link", { name: web("nav.dashboard"), exact: true })).toHaveCount(0)
		await expect(operator.getByRole("link", { name: web("nav.conversations"), exact: true })).toHaveCount(0)
		expect((await operator.request.get("/api/stats")).status()).toBe(403)
	} finally {
		await context.close()
		await expect(await page.request.delete(`/api/users/${user.id}`)).toBeOK()
		await expect(await page.request.delete(`/api/roles/${role.id}`)).toBeOK()
	}
})
