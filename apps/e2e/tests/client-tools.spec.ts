import { expect } from "@playwright/test"

import { test } from "./chat-embed"
import { web, widget } from "./i18n"
import { ADMIN, openDashboard } from "./log-in"

test("browser and connected tool results survive the live answer, reload, and operator transcript", async ({
	page,
	adminRequest,
	chatEmbed,
}) => {
	await expect(
		await adminRequest.post(`/api/agents/${chatEmbed.agentId}/mcp-servers`, {
			data: {
				name: "Shop",
				server: { transport: "stdio", command: "bun", args: ["--no-env-file", "test-fixtures/mcp-demo-server.ts"] },
			},
		}),
	).toBeOK()
	const url = new URL(chatEmbed.widgetUrl)
	url.searchParams.set("tools", "true")
	await page.goto(url.href)
	await page.waitForFunction(() => document.documentElement.dataset.toolsReady === "true")
	await page.getByRole("button", { name: widget("openChat") }).click()
	const dialog = page.getByRole("dialog")
	const input = dialog.getByRole("textbox", { name: widget("messageLabel") })
	await input.fill("Read this page")
	await dialog.getByRole("button", { name: widget("send") }).click()
	await expect(dialog.getByText("Page says host text.", { exact: true })).toBeVisible()
	await expect(dialog.getByRole("status").filter({ hasText: "readPage" })).toContainText(widget("toolCompleted"))
	await expect(dialog.getByRole("status").filter({ hasText: "get_stock_level" })).toContainText(widget("toolCompleted"))
	await input.fill("Remember the page result")
	await dialog.getByRole("button", { name: widget("send") }).click()
	await expect(dialog.getByText("Page says host text.", { exact: true })).toHaveCount(2)
	await page.reload()
	await page.waitForFunction(() => document.documentElement.dataset.toolsReady === "true")
	await page.getByRole("button", { name: widget("openChat") }).click()
	await expect(dialog.getByRole("status").filter({ hasText: "readPage" })).toContainText(widget("toolCompleted"))
	expect(await page.evaluate(() => sessionStorage.getItem("tool-executions"))).toBe("1")
	const captured = (await (await adminRequest.get(`${chatEmbed.providerControlOrigin}/requests`)).json()) as {
		requests: { messages: { role: string; content: unknown }[] }[]
	}
	const followingTurn = captured.requests.at(-1)?.messages
	expect(followingTurn).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ role: "tool", content: expect.stringContaining('"pageText":"host text"') }),
			expect.objectContaining({ role: "tool", content: expect.stringContaining("inStock") }),
		]),
	)
	await openDashboard(page, ADMIN, "/dashboard/conversations")
	await page.getByRole("link", { name: "Read this page" }).click()
	await expect(page.getByText("readPage", { exact: false })).toContainText(web("conversations.toolCompleted"))
	await expect(page.getByText("get_stock_level", { exact: false })).toContainText(web("conversations.connectedTool"))
	await page.reload()
	await expect(page.getByText("readPage", { exact: false })).toContainText(web("conversations.websiteTool"))
})

test("disconnect interrupts an executing browser tool without replaying its page action", async ({
	page,
	adminRequest,
	chatEmbed,
}) => {
	const url = new URL(chatEmbed.widgetUrl)
	url.searchParams.set("tools", "true")
	url.searchParams.set("hold", "true")
	await page.goto(url.href)
	await page.waitForFunction(() => document.documentElement.dataset.toolsReady === "true")
	await page.getByRole("button", { name: widget("openChat") }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("textbox", { name: widget("messageLabel") }).fill("Read this page")
	await dialog.getByRole("button", { name: widget("send") }).click()
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem("tool-executions"))).toBe("1")
	await page.reload()
	await page.waitForFunction(() => document.documentElement.dataset.toolsReady === "true")
	await page.getByRole("button", { name: widget("openChat") }).click()
	await expect(dialog.getByRole("status").filter({ hasText: "readPage" })).toContainText(widget("toolInterrupted"), {
		timeout: 20_000,
	})
	expect(await page.evaluate(() => sessionStorage.getItem("tool-executions"))).toBe("1")
	const captured = (await (await adminRequest.get(`${chatEmbed.providerControlOrigin}/requests`)).json()) as {
		requests: unknown[]
	}
	expect(captured.requests).toHaveLength(1)
})
