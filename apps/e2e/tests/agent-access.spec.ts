import { expect, test } from "@playwright/test"

import { logIn } from "./log-in"

test("admin grants one agent's reporting access and removes it immediately", async ({ page, browser }) => {
	await logIn(page, { username: "admin", password: "admin123" })
	const { agents } = (await (await page.request.get("/api/agents")).json()) as {
		agents: { id: string; name: string }[]
	}
	const agent = agents.find(({ name }) => name === "Website Assistant")
	if (!agent) throw new Error("Missing seeded agent")
	const { users } = (await (await page.request.get("/api/users")).json()) as {
		users: { id: string; username: string; roles: { id: string }[] }[]
	}
	const user = users.find(({ username }) => username === "user")
	if (!user) throw new Error("Missing seeded operator")
	const name = `Reporting ${crypto.randomUUID()}`
	const created = await page.request.post("/api/roles", { data: { name, permissions: [] } })
	await expect(created).toBeOK()
	const { role } = (await created.json()) as { role: { id: string } }
	const context = await browser.newContext({ baseURL: new URL(page.url()).origin })
	try {
		await expect(await page.request.put(`/api/users/${user.id}/roles`, { data: { roleIds: [role.id] } })).toBeOK()
		await page.goto(`/dashboard/agent/${agent.id}`)
		const access = page.locator("[data-slot=card]", { has: page.getByRole("heading", { name: "Access", exact: true }) })
		const addRole = access.getByRole("combobox", { name: "Add role", exact: true })
		await addRole.focus()
		await addRole.press("ArrowDown")
		await expect(page.getByRole("option", { name, exact: true })).toBeVisible()
		await page.keyboard.press("Escape")
		await expect(addRole).toBeFocused()
		await addRole.click()
		await page.getByRole("option", { name, exact: true }).click()
		await expect(page.getByRole("link", { name: "View statistics", exact: true })).toHaveCount(0)
		await expect(page.getByRole("link", { name: "Read conversations", exact: true })).toHaveCount(0)
		await expect(access.getByRole("switch", { name: "View statistics", exact: true })).toBeFocused()
		await expect(access.getByText("Admin: full access", { exact: true })).toHaveCount(0)
		await access.getByRole("switch", { name: "View statistics", exact: true }).check()
		await access.getByRole("switch", { name: "Read conversations", exact: true }).check()
		await page.getByRole("tab", { name: "Context", exact: true }).click()
		await expect(page.getByRole("tab", { name: "Context", exact: true })).toHaveAttribute("aria-selected", "true")
		await page.getByRole("tab", { name: "Configuration", exact: true }).click()
		await expect(access.getByRole("switch", { name: "View statistics", exact: true })).toBeChecked()
		await expect(access.getByRole("switch", { name: "Read conversations", exact: true })).toBeChecked()
		const beforeSave = await page.request.get(`/api/agents/${agent.id}/access`)
		const grants = (await beforeSave.json()) as { roles: { id: string; permissions: string[] }[] }
		expect(grants.roles.find((entry) => entry.id === role.id)?.permissions).toEqual([])
		await access.getByRole("button", { name: "Save permissions", exact: true }).click()
		await expect(access.getByRole("status")).toHaveText("Permissions saved.")

		const operator = await context.newPage()
		await logIn(operator, { username: "user", password: "user1234" })
		await expect(operator.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible()
		await expect(operator.getByRole("link", { name: "Conversations", exact: true })).toBeVisible()
		await expect(operator.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
		await operator.goto(`/dashboard/agent/${agent.id}`)
		await expect(operator).toHaveURL("/dashboard")
		await expect(operator.getByLabel("System prompt")).toHaveCount(0)
		await expect(operator.getByRole("heading", { name: "Access", exact: true })).toHaveCount(0)
		await expect(operator.getByRole("button", { name: "Delete agent", exact: true })).toHaveCount(0)
		await operator.getByRole("link", { name: "Conversations", exact: true }).click()
		await expect(operator).toHaveURL("/dashboard/conversations")

		await access.getByRole("switch", { name: "Delete agent", exact: true }).check()
		page.once("dialog", (dialog) => dialog.accept())
		await access.getByRole("button", { name: "Remove role access", exact: true }).click()
		await expect(access.getByRole("button", { name, exact: true })).toHaveCount(0)
		await expect(addRole).toBeFocused()
		await operator.reload()
		await expect(operator).toHaveURL("/dashboard/account")
		await expect(operator.getByRole("link", { name: "Dashboard", exact: true })).toHaveCount(0)
		await expect(operator.getByRole("link", { name: "Conversations", exact: true })).toHaveCount(0)
		expect((await operator.request.get("/api/stats")).status()).toBe(403)
	} finally {
		await context.close()
		await expect(
			await page.request.put(`/api/users/${user.id}/roles`, { data: { roleIds: user.roles.map(({ id }) => id) } }),
		).toBeOK()
		await expect(await page.request.delete(`/api/roles/${role.id}`)).toBeOK()
	}
})
