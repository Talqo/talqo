import { expect } from "@playwright/test"

import { test } from "./application"
import { web } from "./i18n"
import { ADMIN, openDashboard } from "./log-in"

test("operator tests an agent without an embed, and the chat stays out of Conversations", async ({
	page,
	agent,
	application,
	adminRequest,
}) => {
	const providerControl = `${application.providerOrigin}/control`
	await expect(await adminRequest.post(`${providerControl}/reset`)).toBeOK()
	try {
		await openDashboard(page, ADMIN, `/dashboard/agent/${agent.id}?tab=test-chat`)
		const message = page.getByRole("textbox", { name: web("testChat.messageLabel") })

		await message.fill("Give me the first answer")
		await message.press("Enter")
		await expect(page.getByText("First", { exact: true })).toBeVisible()
		await expect(page.getByRole("button", { name: web("testChat.stop") })).toBeVisible()
		await expect(await adminRequest.post(`${providerControl}/release`)).toBeOK()

		await expect(page.getByText("First streamed answer.", { exact: true })).toBeVisible()
		await expect(page.getByText(web("testChat.you"), { exact: true })).toBeVisible()
		await expect(message).toHaveValue("")
		const conversations = await adminRequest.get("/api/conversations", { params: { agentId: agent.id } })
		await expect(conversations).toBeOK()
		expect(await conversations.json()).toMatchObject({ total: 0 })
	} finally {
		await expect(await adminRequest.post(`${providerControl}/reset`)).toBeOK()
	}
})
