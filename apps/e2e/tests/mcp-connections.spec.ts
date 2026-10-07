import { expect, test, type Page } from "@playwright/test"

const OPERATOR = { username: "admin", password: "admin123" }
const SEEDED_AGENT = "Website Assistant"

async function logIn(page: Page) {
	await page.goto("/login")
	await page.getByLabel("Username").fill(OPERATOR.username)
	await page.getByLabel("Password", { exact: true }).fill(OPERATOR.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}

async function seededAgentId(page: Page): Promise<string> {
	await expect(await page.request.post("/api/auth/login", { data: OPERATOR })).toBeOK()
	const response = await page.request.get("/api/agents")
	await expect(response).toBeOK()
	const { agents } = (await response.json()) as { agents: { id: string; name: string }[] }
	const agent = agents.find(({ name }) => name === SEEDED_AGENT)
	if (!agent) throw new Error("Seed agent is missing")
	return agent.id
}

async function openToolsTab(page: Page, agentId: string) {
	await page.goto(`/dashboard/agent/${agentId}?tab=mcp`)
	await expect(page.getByText("Give this agent tools from your own systems")).toBeVisible()
}

async function removeConnection(page: Page, name: string) {
	const card = page.getByTestId("mcp-server-card").filter({ hasText: name })
	await card.getByRole("button", { name: "Remove", exact: true }).click()
	const confirm = page.getByRole("dialog")
	await confirm.getByRole("button", { name: "Remove connection" }).click()
	await expect(page.getByText(name)).toHaveCount(0)
}

test("operator adds an unreachable http connection, edits it, and removes it", async ({ page }) => {
	const agentId = await seededAgentId(page)
	await logIn(page)
	await openToolsTab(page, agentId)

	const name = `e2e_http_${Date.now()}`
	await page.getByRole("button", { name: "Add connection" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("button", { name: "Add connection" }).click()
	await expect(dialog.getByText("Give the connection a name.")).toBeVisible()

	await dialog.getByLabel("Name").fill(name)
	await dialog.getByLabel("Server address").fill("http://127.0.0.1:9/mcp")
	await dialog.getByRole("button", { name: "Add connection" }).click()

	// The save succeeds and the card shows the failure state instead of an error.
	// Scoped to the new card: the seed already shows a broken connection of its own.
	const httpCard = page.getByTestId("mcp-server-card").filter({ hasText: name })
	await expect(httpCard.getByText("This connection could not be reached.")).toBeVisible()

	await httpCard.getByRole("button", { name: "Edit", exact: true }).click()
	const editDialog = page.getByRole("dialog")
	await editDialog.getByLabel("Name").fill(`${name}_2`)
	await editDialog.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText(`${name}_2`)).toBeVisible()

	await removeConnection(page, `${name}_2`)
})

test("operator adds a stdio connection with tools and the toggle survives reload", async ({ page }) => {
	const agentId = await seededAgentId(page)
	await logIn(page)
	await openToolsTab(page, agentId)

	const name = `e2e_stdio_${Date.now()}`
	await page.getByRole("button", { name: "Add connection" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Name").fill(name)
	await dialog.getByRole("combobox", { name: "Type" }).click()
	await page.getByRole("option", { name: "stdio" }).click()
	await dialog.getByLabel("Command").fill("bun")
	// Arguments render above environment variables, so the first Add opens an argument row.
	await dialog.getByRole("button", { name: "Add" }).first().click()
	await dialog.getByPlaceholder("@shop/inventory-server").fill("test-fixtures/mcp-demo-server.ts")
	await dialog.getByRole("button", { name: "Add connection" }).click()

	await expect(page.getByText(name)).toBeVisible()
	await expect(
		page.getByTestId("mcp-server-card").filter({ hasText: name }).getByText("Tools available: 3"),
	).toBeVisible()

	const stdioCard = () => page.getByTestId("mcp-server-card").filter({ hasText: name })
	await stdioCard().getByRole("button", { name: "Show tools" }).click()
	const toggle = stdioCard().getByRole("switch", { name: "get_stock_level" })
	await expect(toggle).toBeVisible()
	await toggle.click()
	await page.reload()
	await openToolsTab(page, agentId)
	await stdioCard().getByRole("button", { name: "Show tools" }).click()
	await expect(stdioCard().getByRole("switch", { name: "get_stock_level" })).not.toBeChecked()

	await removeConnection(page, name)
})

test("a stored header survives an edit that leaves its value blank", async ({ page }) => {
	const agentId = await seededAgentId(page)
	await logIn(page)
	await openToolsTab(page, agentId)

	const name = `e2e_secret_${Date.now()}`
	await page.getByRole("button", { name: "Add connection" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Name").fill(name)
	await dialog.getByLabel("Server address").fill("http://127.0.0.1:9/mcp")
	await dialog.getByRole("combobox", { name: "Authentication" }).click()
	await page.getByRole("option", { name: "Secret key" }).click()
	await dialog.getByRole("button", { name: "Add", exact: true }).click()
	await dialog.getByPlaceholder("Header name").fill("X-E2E-Key")
	await dialog.getByPlaceholder("Header value").fill("s3cret")
	await dialog.getByRole("button", { name: "Add connection" }).click()
	await expect(page.getByText(name)).toBeVisible()

	const servers = (await (await page.request.get(`/api/agents/${agentId}/mcp-servers`)).json()) as {
		servers: { headers: { hasValue: boolean; name: string }[]; id: string; name: string }[]
	}
	const server = servers.servers.find(({ name: candidate }) => candidate === name)
	expect(server?.headers).toEqual([{ hasValue: true, name: "X-E2E-Key" }])

	await page
		.getByTestId("mcp-server-card")
		.filter({ hasText: name })
		.getByRole("button", { name: "Edit", exact: true })
		.click()
	const editDialog = page.getByRole("dialog")
	await expect(editDialog.getByPlaceholder("Header name")).toHaveValue("X-E2E-Key")
	await expect(editDialog.getByPlaceholder("Header value")).toHaveValue("")
	await editDialog.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText(name)).toBeVisible()

	const reread = (await (await page.request.get(`/api/agents/${agentId}/mcp-servers`)).json()) as {
		servers: { headers: { hasValue: boolean; name: string }[]; id: string; name: string }[]
	}
	expect(reread.servers.find(({ name: candidate }) => candidate === name)?.headers).toEqual([
		{ hasValue: true, name: "X-E2E-Key" },
	])

	await removeConnection(page, name)
})
