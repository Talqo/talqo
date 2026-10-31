import { expect, type Page } from "@playwright/test"

import { test } from "./application"
import { web } from "./i18n"
import { ADMIN, logInThroughApi } from "./log-in"

async function openToolsTab(page: Page, agentId: string) {
	await page.goto(`/dashboard/agent/${agentId}?tab=mcp`)
	await expect(page.getByText(web("mcp.panelDescription"))).toBeVisible()
}

async function removeConnection(page: Page, name: string) {
	const card = page.getByTestId("mcp-server-card").filter({ hasText: name })
	await card.getByRole("button", { name: web("mcp.remove"), exact: true }).click()
	const confirm = page.getByRole("alertdialog")
	await confirm.getByRole("button", { name: web("mcp.removeConfirm") }).click()
	await expect(page.getByText(name)).toHaveCount(0)
}

test("operator adds an unavailable http connection, edits it, and removes it", async ({ page, application, agent }) => {
	const agentId = agent.id
	await logInThroughApi(page, ADMIN)
	await openToolsTab(page, agentId)

	const name = `e2e_http_${Date.now()}`
	await page.getByRole("button", { name: web("mcp.add") }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("button", { name: web("mcp.add") }).click()
	await expect(dialog.getByText(web("mcp.errorName"))).toBeVisible()

	await dialog.getByLabel(web("mcp.name")).fill(name)
	await dialog.getByLabel(web("mcp.address")).fill(`${application.providerOrigin}/mcp-unavailable`)
	await dialog.getByRole("button", { name: web("mcp.add") }).click()

	const httpCard = page.getByTestId("mcp-server-card").filter({ hasText: name })
	await expect(httpCard.getByText(web("mcp.unreachable"))).toBeVisible()

	await httpCard.getByRole("button", { name: web("mcp.edit"), exact: true }).click()
	const editDialog = page.getByRole("dialog")
	await editDialog.getByLabel(web("mcp.name")).fill(`${name}_2`)
	await editDialog.getByRole("button", { name: web("mcp.save") }).click()
	await expect(editDialog).toBeHidden()
	await expect(page.getByText(`${name}_2`)).toBeVisible()
	await page.reload()
	await expect(page.getByText(`${name}_2`)).toBeVisible()

	await removeConnection(page, `${name}_2`)
})

test("operator adds a stdio connection with tools and the toggle survives reload", async ({ page, agent }) => {
	const agentId = agent.id
	await logInThroughApi(page, ADMIN)
	await openToolsTab(page, agentId)

	const name = `e2e_stdio_${Date.now()}`
	await page.getByRole("button", { name: web("mcp.add") }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel(web("mcp.name")).fill(name)
	await dialog.getByRole("combobox", { name: web("mcp.kind") }).click()
	await page.getByRole("option", { name: web("mcp.transportStdio") }).click()
	await dialog.getByLabel(web("mcp.command")).fill("bun")
	// Arguments render above environment variables, so the first Add opens an argument row.
	await dialog
		.getByRole("button", { name: web("mcp.addArgument") })
		.first()
		.click()
	await dialog.getByPlaceholder(web("mcp.argumentPlaceholder")).fill("--no-env-file")
	await dialog
		.getByRole("button", { name: web("mcp.addArgument") })
		.first()
		.click()
	await dialog.getByPlaceholder(web("mcp.argumentPlaceholder")).last().fill("test-fixtures/mcp-demo-server.ts")
	await dialog.getByRole("button", { name: web("mcp.add") }).click()

	await expect(page.getByText(name)).toBeVisible()
	await expect(
		page
			.getByTestId("mcp-server-card")
			.filter({ hasText: name })
			.getByText(web("mcp.toolsAvailable", { toolCount: 3 })),
	).toBeVisible()

	const stdioCard = () => page.getByTestId("mcp-server-card").filter({ hasText: name })
	await stdioCard()
		.getByRole("button", { name: web("mcp.showTools") })
		.click()
	const toggle = stdioCard().getByRole("switch", { name: "get_stock_level" })
	await expect(toggle).toBeChecked()
	await toggle.click()
	await expect(toggle).not.toBeChecked()
	await page.reload()
	await openToolsTab(page, agentId)
	await stdioCard()
		.getByRole("button", { name: web("mcp.showTools") })
		.click()
	await expect(stdioCard().getByRole("switch", { name: "get_stock_level" })).not.toBeChecked()

	await removeConnection(page, name)
})

test("a stored header survives an edit that leaves its value blank", async ({ page, application, agent }) => {
	const agentId = agent.id
	await logInThroughApi(page, ADMIN)
	await openToolsTab(page, agentId)

	const name = `e2e_secret_${Date.now()}`
	await page.getByRole("button", { name: web("mcp.add") }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel(web("mcp.name")).fill(name)
	await dialog.getByLabel(web("mcp.address")).fill(`${application.providerOrigin}/mcp-unavailable`)
	await dialog.getByRole("combobox", { name: web("mcp.authMethod") }).click()
	await page.getByRole("option", { name: web("mcp.authHeaders") }).click()
	await dialog.getByRole("button", { name: web("mcp.addHeader"), exact: true }).click()
	await dialog.getByPlaceholder(web("mcp.headerName")).fill("X-E2E-Key")
	await dialog.getByPlaceholder(web("mcp.headerValue")).fill("s3cret")
	await dialog.getByRole("button", { name: web("mcp.add") }).click()
	await expect(page.getByText(name)).toBeVisible()

	const servers = (await (await page.request.get(`/api/agents/${agentId}/mcp-servers`)).json()) as {
		servers: { headers: { hasValue: boolean; name: string }[]; id: string; name: string }[]
	}
	const server = servers.servers.find(({ name: candidate }) => candidate === name)
	expect(server?.headers).toEqual([{ hasValue: true, name: "X-E2E-Key" }])

	await page
		.getByTestId("mcp-server-card")
		.filter({ hasText: name })
		.getByRole("button", { name: web("mcp.edit"), exact: true })
		.click()
	const editDialog = page.getByRole("dialog")
	await expect(editDialog.getByPlaceholder(web("mcp.headerName"))).toHaveValue("X-E2E-Key")
	await expect(editDialog.getByPlaceholder(web("mcp.headerValue"))).toHaveValue("")
	await editDialog.getByRole("button", { name: web("mcp.save") }).click()
	await expect(editDialog).toBeHidden()
	await expect(page.getByText(name)).toBeVisible()

	const reread = (await (await page.request.get(`/api/agents/${agentId}/mcp-servers`)).json()) as {
		servers: { headers: { hasValue: boolean; name: string }[]; id: string; name: string }[]
	}
	expect(reread.servers.find(({ name: candidate }) => candidate === name)?.headers).toEqual([
		{ hasValue: true, name: "X-E2E-Key" },
	])

	await removeConnection(page, name)
})
