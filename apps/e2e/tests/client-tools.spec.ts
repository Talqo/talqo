import { expect, type Locator, type Page } from "@playwright/test"

import { test } from "./chat-embed"
import { web, widget } from "./i18n"
import { ADMIN, openDashboard } from "./log-in"

async function openToolChat(page: Page, widgetUrl: string, params: Record<string, string> = {}) {
	const url = new URL(widgetUrl)
	url.searchParams.set("tools", "true")
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
	await page.goto(url.href)
	await page.waitForFunction(() => document.documentElement.dataset.toolsReady === "true")
	await page.getByRole("button", { name: widget("openChat") }).click()
}

async function reopenChat(page: Page) {
	await page.reload()
	await page.waitForFunction(() => document.documentElement.dataset.toolsReady === "true")
	await page.getByRole("button", { name: widget("openChat") }).click()
}

async function expandToolGroup(scope: Page | Locator, label: string) {
	const summary = scope.getByText(label, { exact: true })
	await expect(summary).toBeVisible()
	await summary.click()
}

test("browser and backend tool results survive the live answer, reload, and operator transcript", async ({
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
	await openToolChat(page, chatEmbed.widgetUrl)
	const dialog = page.getByRole("dialog")
	const input = dialog.getByRole("textbox", { name: widget("messageLabel") })
	await input.fill("Read this page")
	await dialog.getByRole("button", { name: widget("send") }).click()
	await expect(dialog.getByText("Page says host text.", { exact: true })).toBeVisible()
	await expandToolGroup(dialog, widget("toolsCalled", { count: 2 }))
	await expect(dialog.getByRole("status").filter({ hasText: widget("websiteTool") })).toContainText(
		widget("toolCompleted"),
	)
	await expect(dialog.getByRole("status").filter({ hasText: widget("backendTool") })).toContainText(
		widget("toolCompleted"),
	)
	await expect(dialog.getByText("readPage", { exact: false })).toHaveCount(0)
	await expect(dialog.getByText("get_stock_level", { exact: false })).toHaveCount(0)
	await input.fill("Remember the page result")
	await dialog.getByRole("button", { name: widget("send") }).click()
	await expect(dialog.getByText("Page says host text.", { exact: true })).toHaveCount(2)
	await reopenChat(page)
	await expandToolGroup(dialog, widget("toolsCalled", { count: 2 }))
	await expect(dialog.getByRole("status").filter({ hasText: widget("websiteTool") })).toContainText(
		widget("toolCompleted"),
	)
	expect(await page.evaluate(() => sessionStorage.getItem("tool-executions"))).toBe("1")
	const captured = (await (await adminRequest.get(`${chatEmbed.providerControlOrigin}/requests`)).json()) as {
		requests: Array<{ messages: Array<{ role: string; content: unknown }> }>
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
	await expandToolGroup(page, web("conversations.toolsCalled", { count: 2 }))
	await expect(page.getByRole("status").filter({ hasText: web("conversations.websiteTool") })).toContainText(
		web("conversations.toolCompleted"),
	)
	await expect(page.getByRole("status").filter({ hasText: web("conversations.backendTool") })).toContainText(
		web("conversations.toolCompleted"),
	)
	await expect(page.getByText("readPage", { exact: false })).toHaveCount(0)
	await expect(page.getByText("get_stock_level", { exact: false })).toHaveCount(0)
	await page.reload()
	await expandToolGroup(page, web("conversations.toolsCalled", { count: 2 }))
	await expect(page.getByRole("status").filter({ hasText: web("conversations.websiteTool") })).toContainText(
		web("conversations.toolCompleted"),
	)
})

test("disconnect interrupts an executing browser tool without replaying its page action", async ({
	page,
	adminRequest,
	chatEmbed,
}) => {
	await openToolChat(page, chatEmbed.widgetUrl, { hold: "true" })
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("textbox", { name: widget("messageLabel") }).fill("Read this page")
	await dialog.getByRole("button", { name: widget("send") }).click()
	await expect.poll(() => page.evaluate(() => sessionStorage.getItem("tool-executions"))).toBe("1")
	await reopenChat(page)
	await expect(dialog.getByRole("status").filter({ hasText: widget("websiteTool") })).toContainText(
		widget("toolInterrupted"),
		{
			timeout: 20_000,
		},
	)
	expect(await page.evaluate(() => sessionStorage.getItem("tool-executions"))).toBe("1")
	const captured = (await (await adminRequest.get(`${chatEmbed.providerControlOrigin}/requests`)).json()) as {
		requests: Array<unknown>
	}
	expect(captured.requests).toHaveLength(1)
})
