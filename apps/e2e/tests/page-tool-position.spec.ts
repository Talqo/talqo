import type { Tool } from "ai"

import { expect } from "@playwright/test"

import { test } from "./application"

test("approval follows its target, avoids the chat, and falls back inside a small viewport", async ({
	page,
	application,
}) => {
	await page.setViewportSize({ width: 1280, height: 844 })
	await page.goto(application.widgetHostOrigin)
	await page.setContent(`<style>body{min-height:1800px}</style><button id="purchase" style="position:absolute;left:calc(50vw - 60px);top:300px;width:120px;height:44px">Place order</button>
<div id="chat" style="position:fixed;left:calc(50vw + 60px);top:240px;width:350px;height:360px;background:white">Private chat</div>`)
	await page.evaluate(async () => {
		type PageToolModule = {
			createPageTool(options: { exclude: Element[]; language: string; stop(): Promise<void> }): {
				definition: Tool<unknown, unknown>
				dispose(): void
			}
		}
		const moduleUrl = "/page-tool.js"
		const { createPageTool } = (await import(moduleUrl)) as PageToolModule
		const excluded = document.querySelector("#chat")
		const purchase = document.querySelector("#purchase")
		if (!excluded || !purchase) throw new Error("Missing page controls")
		purchase.addEventListener("click", () => {
			document.body.dataset.purchased = "true"
		})
		const controller = new AbortController()
		const pageTool = createPageTool({ exclude: [excluded], language: "en", stop: async () => controller.abort() })
		const execute = pageTool.definition.execute
		if (!execute) throw new Error("Missing page tool")
		const callOptions = { toolCallId: "approval", messages: [], abortSignal: controller.signal, context: undefined }
		const observation = await execute({ action: "observe" }, callOptions)
		if (
			!observation ||
			typeof observation !== "object" ||
			!("snapshot" in observation) ||
			typeof observation.snapshot !== "string" ||
			!("content" in observation) ||
			typeof observation.content !== "string"
		)
			throw new Error("Missing page observation")
		const index = observation.content.match(/\[(\d+)\].*id=purchase/)?.[1]
		if (!index) throw new Error("Missing purchase target")
		void Promise.resolve(
			execute(
				{
					action: "click",
					snapshot: observation.snapshot,
					index: Number(index),
					description: "Placing your order",
					approval: "Place one order for $53.00",
				},
				callOptions,
			),
		).finally(() => pageTool.dispose())
	})
	const approval = page.getByRole("region", { name: "Talqo" })
	await expect(approval.getByRole("button", { name: "Approve", exact: true })).toBeVisible()
	await expect
		.poll(async () => {
			const card = await approval.boundingBox()
			const target = await page.getByRole("button", { name: "Place order", exact: true }).boundingBox()
			if (!card || !target) throw new Error("Missing approval or target")
			return Math.round(target.x - card.x - card.width)
		})
		.toBe(12)
	await page.evaluate(() => window.scrollTo(0, 100))
	await expect.poll(async () => Math.round((await approval.boundingBox())?.y ?? -1)).toBe(200)
	await page.locator("#chat").evaluate((element) => {
		element.style.left = "0"
	})
	await expect
		.poll(async () => {
			const card = await approval.boundingBox()
			const target = await page.getByRole("button", { name: "Place order", exact: true }).boundingBox()
			if (!card || !target) throw new Error("Missing approval or target")
			return Math.round(card.x - target.x - target.width)
		})
		.toBe(12)
	await page.evaluate(() => window.scrollTo(0, 50))
	await page.setViewportSize({ width: 640, height: 480 })
	await expect
		.poll(async () => {
			const card = await approval.boundingBox()
			const target = await page.getByRole("button", { name: "Place order", exact: true }).boundingBox()
			if (!card || !target) throw new Error("Missing approval or target")
			return Math.round(target.y - card.y - card.height)
		})
		.toBe(12)
	await page.setViewportSize({ width: 390, height: 844 })
	await expect
		.poll(async () => {
			const card = await approval.boundingBox()
			if (!card) throw new Error("Missing approval")
			return { top: card.y, withinViewport: card.x >= 16 && card.x + card.width <= 374 }
		})
		.toEqual({ top: 16, withinViewport: true })
	await expect(page.locator("body")).not.toHaveAttribute("data-purchased")
	await approval.getByRole("button", { name: "Cancel", exact: true }).click()
	await expect(approval).toHaveCount(0)
	await expect(page.locator("body")).not.toHaveAttribute("data-purchased")
})
