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
		await access.getByRole("button", { name: "Add role", exact: true }).click()
		await access.getByLabel("Choose a role").selectOption(role.id)
		await access.getByRole("checkbox", { name: "View statistics", exact: true }).check()
		await access.getByRole("checkbox", { name: "Read conversations", exact: true }).check()
		const beforeSave = await page.request.get(`/api/agents/${agent.id}/access`)
		const grants = (await beforeSave.json()) as { roles: { id: string; permissions: string[] }[] }
		expect(grants.roles.find((entry) => entry.id === role.id)?.permissions).toEqual([])
		await access.getByRole("button", { name: "Save permissions", exact: true }).click()
		await expect(access.getByRole("status")).toHaveText("Permissions saved.")

		const operator = await context.newPage()
		await logIn(operator, { username: "user", password: "user1234" })
		await expect(operator.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible()
		await expect(operator.getByRole("link", { name: "Conversations", exact: true })).toBeVisible()
		await operator.getByRole("link", { name: "Agents", exact: true }).click()
		await expect(operator.getByRole("link", { name: /Website Assistant/ })).toBeVisible()
		await expect(operator.getByRole("link", { name: /Product Advisor/ })).toHaveCount(0)
		await operator.getByRole("link", { name: /Website Assistant/ }).click()
		await expect(operator.getByLabel("System prompt")).toHaveCount(0)
		await expect(operator.getByRole("heading", { name: "Access", exact: true })).toHaveCount(0)
		await expect(operator.getByRole("button", { name: "Delete agent", exact: true })).toHaveCount(0)

		page.once("dialog", (dialog) => dialog.accept())
		await access.getByRole("button", { name: "Remove role access", exact: true }).click()
		await expect(access.getByRole("button", { name, exact: true })).toHaveCount(0)
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
