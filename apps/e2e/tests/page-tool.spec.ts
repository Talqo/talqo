import { expect, type Locator, type Page } from "@playwright/test"

import { test } from "./chat-embed"
import { widget } from "./i18n"
import { WIDGET_APPEARANCE } from "./widget-appearance"

const JOURNEY_TIMEOUT = 30_000
const REQUEST = "Buy two large T-shirts. Deliver to Alex Example, 12 Market Street."

async function openShopChat(page: Page, widgetUrl: string, ui: "widget" | "sdk" = "widget"): Promise<Locator> {
	const url = new URL(widgetUrl)
	url.searchParams.set("shop", "catalog")
	if (ui === "sdk") url.searchParams.set("sdk", "true")
	await page.goto(url.href)
	if (ui === "widget") await page.getByRole("button", { name: widget("openChat") }).click()
	return ui === "widget" ? page.getByRole("dialog") : page.getByRole("form", { name: "Custom chat" })
}

async function startPurchase(page: Page, widgetUrl: string, ui: "widget" | "sdk" = "widget"): Promise<Locator> {
	const chat = await openShopChat(page, widgetUrl, ui)
	await chat.getByRole("textbox", { name: widget("messageLabel") }).fill(REQUEST)
	await chat.getByRole("button", { name: widget("send") }).click()
	const approval = page.getByRole("region", { name: "Talqo" })
	await expect(approval.getByRole("button", { name: "Approve", exact: true })).toBeVisible({ timeout: JOURNEY_TIMEOUT })
	return approval
}
test("page observations reflect live controls and reject disabled or detached targets", async ({
	page,
	application,
}) => {
	await page.goto(application.widgetHostOrigin)
	await page.setContent(`<div id="root"><label>Email <input id="email" value="old@example.com"></label>
<label>Delivery <select id="delivery"><option>Standard</option><option>Express</option></select></label>
<span id="label">Save product</span><button aria-labelledby="label" id="save">Save</button>
<button id="target">Place order</button>
<label>Password <input type="password" value="password-secret"></label>
<label>Card <input autocomplete="cc-number" data-talqo-hidden value="4111111111111111"></label>
<input type="tel" name="credit-card" aria-label="Card number" value="card-field-secret">
<fieldset data-talqo-hidden><input name="code" value="payment-form-secret"></fieldset>
<form id="unsafe-form" action="https://elsewhere.example/"><input id="unsafe-input"></form>
<button id="outside-submit" form="unsafe-form">External submission</button>
<form><button id="override" formaction="https://elsewhere.example/">Override</button>
<button id="new-tab" formtarget="_blank">New tab</button></form>
<a id="base-link" href="/">Base target</a></div><div id="chat"><button>Private chat control</button></div>`)
	await page.addScriptTag({
		type: "module",
		content: 'import { createPageTool } from "/page-tool.js"; globalThis.createPageTool = createPageTool',
	})
	const result = await page.evaluate(async () => {
		type PageToolModule = {
			createPageTool(options: { exclude: Array<Element>; language: string }): {
				definition: { execute(input: unknown, options: { abortSignal: AbortSignal }): Promise<unknown> }
				dispose(): void
			}
		}
		history.replaceState(null, "", "/?access_token=url-secret#fragment-secret")
		const { createPageTool } = globalThis as unknown as PageToolModule
		const excluded = document.querySelector("#chat")
		if (!excluded) throw new Error("Missing excluded root")
		const email = document.querySelector("#email")
		email?.addEventListener("focus", () => email.setAttribute("aria-invalid", "false"), { once: true })
		const controller = new AbortController()
		const pageTool = createPageTool({ exclude: [excluded], language: "en" })
		const execute = pageTool.definition.execute
		if (!execute) throw new Error("Missing page tool")
		const run = (input: unknown) =>
			execute(input, {
				abortSignal: controller.signal,
			})
		try {
			const before = (await run({ action: "observe" })) as { snapshot: string; content: string }
			type ControlAction = {
				action: "click" | "fill" | "select"
				approval: null
				text?: string
				option?: string
			}
			const runOn = (observed: { snapshot: string; content: string }, id: string, input: ControlAction) => {
				const line = observed.content.split("\n").find((entry) => entry.includes(`id=${id}`))
				const value = line?.match(/\[(\d+)\]/)?.[1]
				if (!value) throw new Error(`Missing ${id}: ${observed.content}`)
				return run({ ...input, snapshot: observed.snapshot, index: Number(value) })
			}
			const filled = (await runOn(before, "email", {
				action: "fill",
				approval: null,
				text: "new@example.com",
			})) as { page: { snapshot: string; content: string } }
			const selected = (await runOn(filled.page, "delivery", {
				action: "select",
				approval: null,
				option: "Express",
			})) as { page: { snapshot: string; content: string } }
			const target = document.querySelector<HTMLButtonElement>("#target")
			if (!target) throw new Error("Missing target")
			target.disabled = true
			const disabled = await runOn(selected.page, "target", {
				action: "click",
				approval: null,
			})
			target.disabled = false
			const refreshed = (await run({ action: "observe" })) as { snapshot: string; content: string }
			target.remove()
			const detached = await runOn(refreshed, "target", {
				action: "click",
				approval: null,
			})
			const blocked: Array<unknown> = []
			for (const id of ["unsafe-input", "outside-submit", "override", "new-tab", "base-link"]) {
				if (id === "base-link") {
					const base = document.createElement("base")
					base.target = "_blank"
					document.head.append(base)
				}
				const current = (await run({ action: "observe" })) as { snapshot: string; content: string }
				const denied = await runOn(current, id, {
					action: "click",
					approval: null,
				})
				blocked.push(denied)
			}
			return { before, filled, selected, disabled, detached, blocked }
		} finally {
			pageTool.dispose()
		}
	})
	expect(result.before.content).not.toContain("Private chat control")
	expect(JSON.stringify(result.before)).not.toMatch(
		/password-secret|4111111111111111|card-field-secret|payment-form-secret|url-secret|fragment-secret/,
	)
	expect(result.before.content).toContain("Save product")
	expect(result.filled).toMatchObject({ status: "dispatched" })
	expect(result.filled.page.content).toContain("new@example.com")
	expect(result.selected.page.content).toContain("value=Express")
	expect(result.disabled).toMatchObject({ status: "failed" })
	expect(result.detached).toMatchObject({ status: "failed" })
	expect(result.blocked).toEqual(
		Array.from({ length: 5 }, () =>
			expect.objectContaining({
				status: "failed",
				message: expect.stringContaining("Only this tab and origin"),
			}),
		),
	)
})

for (const ui of ["widget", "sdk"] as const)
	test(`${ui}: one purchase request completes checkout across page loads after exact order approval`, async ({
		page,
		chatEmbed,
	}) => {
		const approval = await startPurchase(page, chatEmbed.widgetUrl, ui)
		await expect(page.getByRole("textbox", { name: widget("messageLabel") })).toBeVisible()
		await expect(approval).toContainText("$53.00")
		expect(await page.evaluate(() => sessionStorage.getItem("talqo-demo-shop"))).toContain('"order":null')
		await approval.getByRole("button", { name: "Approve", exact: true }).click()
		await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
		await expect(page.locator("#demo-shop")).toContainText("quantity 2")
		await expect(page.locator("#demo-shop")).toContainText("Large")
		await expect(page.locator("#demo-shop")).toContainText("Total: $53.00")
		await expect(page.getByText("Your order is confirmed.", { exact: true })).toBeVisible()
		const order = await page.evaluate(() => sessionStorage.getItem("talqo-demo-shop"))
		await page.reload()
		await expect(page.getByRole("textbox", { name: widget("messageLabel") })).toBeVisible()
		await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
		expect(await page.evaluate(() => sessionStorage.getItem("talqo-demo-shop"))).toBe(order)
	})

test("changed delivery and a page reload require fresh approval; Cancel leaves the order unplaced", async ({
	page,
	chatEmbed,
}) => {
	const approval = await startPurchase(page, chatEmbed.widgetUrl)
	const chat = page.getByRole("dialog")
	const approve = approval.getByRole("button", { name: "Approve", exact: true })
	await page.getByRole("combobox", { name: "Delivery", exact: true }).selectOption("Express")
	await approve.click()
	await expect(approval).toContainText("$58.00")
	expect(await page.evaluate(() => sessionStorage.getItem("talqo-demo-shop"))).toContain('"order":null')
	await page.reload()
	await expect(approval).toContainText("$58.00", { timeout: JOURNEY_TIMEOUT })
	expect(await page.evaluate(() => sessionStorage.getItem("talqo-demo-shop"))).toContain('"order":null')
	await approval.getByRole("button", { name: "Cancel", exact: true }).click()
	await expect(approval).toHaveCount(0)
	expect(await page.evaluate(() => sessionStorage.getItem("talqo-demo-shop"))).toContain('"order":null')
	await expect(chat.getByText("The order was not placed.", { exact: true })).toBeVisible()
})

test("Stop cancels a pending order approval without committing", async ({ page, chatEmbed }) => {
	const approval = await startPurchase(page, chatEmbed.widgetUrl)
	await page
		.getByRole("dialog")
		.getByRole("button", { name: widget("stopGenerating") })
		.click()
	await expect(approval).toHaveCount(0)
	await page.reload()
	await expect(page.getByRole("heading", { name: "Review order" })).toBeVisible()
	expect(await page.evaluate(() => sessionStorage.getItem("talqo-demo-shop"))).toContain('"order":null')
	await expect(page.getByRole("region", { name: "Talqo" })).toHaveCount(0)
})

test("widget visibility survives reloads and closing is remembered", async ({ page, chatEmbed }) => {
	await openShopChat(page, chatEmbed.widgetUrl)
	await page.reload()
	await expect(page.getByRole("dialog")).toBeVisible()
	await page
		.getByRole("dialog")
		.getByRole("button", { name: widget("closeChat") })
		.click()
	await page.reload()
	await expect(page.getByRole("button", { name: widget("openChat") })).toBeVisible()
	await expect(page.getByRole("dialog")).toHaveCount(0)
	await page.getByRole("button", { name: widget("openChat") }).click()
	await expect(page.getByRole("dialog")).toBeVisible()
})

test("widget remains usable when visibility storage is blocked", async ({ page, chatEmbed }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, "localStorage", {
			get() {
				throw new DOMException("Storage is blocked", "SecurityError")
			},
		})
	})
	const chat = await openShopChat(page, chatEmbed.widgetUrl)
	await expect(chat).toBeVisible()
	await chat.getByRole("button", { name: widget("closeChat") }).click()
	await expect(chat).toHaveCount(0)
})

test("blocked tab storage disables website actions without breaking ordinary chat", async ({ page, chatEmbed }) => {
	await page.addInitScript(() => {
		Object.defineProperty(window, "sessionStorage", {
			get() {
				throw new DOMException("Storage is blocked", "SecurityError")
			},
		})
	})
	await page.goto(chatEmbed.widgetUrl)
	await page.getByRole("button", { name: widget("openChat") }).click()
	const chat = page.getByRole("dialog")
	await chat.getByRole("textbox", { name: widget("messageLabel") }).fill("Where is my order?")
	await chat.getByRole("button", { name: widget("send") }).click()
	await expect(chat.getByText("It ships tomorrow.", { exact: true })).toBeVisible()
	await expect(page.getByRole("region", { name: "Talqo" })).toHaveCount(0)
})

test("existing custom SDK UIs can keep eight tools without opting into website actions", async ({
	page,
	chatEmbed,
}) => {
	const url = new URL(chatEmbed.widgetUrl)
	url.searchParams.set("sdk", "true")
	url.searchParams.set("legacy", "true")
	await page.goto(url.href)
	const chat = page.getByRole("form", { name: "Custom chat" })
	await chat.getByRole("textbox", { name: "Message" }).fill("Where is my order?")
	await chat.getByRole("button", { name: "Send message" }).click()
	await expect(page.getByRole("status", { name: "Reply" })).toHaveText("It ships **tomorrow**.")
})

test("page approvals follow the widget palette, including theme changes", async ({ page, chatEmbed, adminRequest }) => {
	await expect(
		await adminRequest.put(`/api/embeds/${chatEmbed.embedId}`, {
			data: { agentId: chatEmbed.agentId, name: "Chat test", appearance: { ...WIDGET_APPEARANCE, themeToggle: true } },
		}),
	).toBeOK()
	const approval = await startPurchase(page, chatEmbed.widgetUrl)
	const approve = approval.getByRole("button", { name: "Approve", exact: true })
	await expect(approve).toHaveCSS("background-color", "rgb(124, 58, 237)")
	await page.getByRole("button", { name: widget("switchToDark") }).click()
	await expect(approve).toHaveCSS("background-color", "rgb(52, 211, 153)")
	await expect(approval).toHaveCSS("background-color", "rgb(10, 10, 10)")
	await approval.getByRole("button", { name: "Cancel", exact: true }).click()
})

test("the visitor supplies missing details without repeating the purchase objective", async ({ page, chatEmbed }) => {
	const chat = await openShopChat(page, chatEmbed.widgetUrl)
	await chat.getByRole("textbox", { name: widget("messageLabel") }).fill("Buy two large T-shirts.")
	await chat.getByRole("button", { name: widget("send") }).click()
	await expect(page.getByRole("heading", { name: "Checkout", exact: true })).toBeVisible({ timeout: JOURNEY_TIMEOUT })
	await expect(chat.getByText("What full name and delivery address should I use?", { exact: true })).toBeVisible()
	await chat.getByRole("textbox", { name: widget("messageLabel") }).fill("Alex Example, 12 Market Street.")
	await chat.getByRole("button", { name: widget("send") }).click()
	const approval = page.getByRole("region", { name: "Talqo" })
	await expect(approval).toContainText("$53.00", { timeout: JOURNEY_TIMEOUT })
	await approval.getByRole("button", { name: "Approve", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()
	await expect(page.locator("#demo-shop")).toContainText("Alex Example, 12 Market Street")
})
