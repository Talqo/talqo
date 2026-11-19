import { expect } from "@playwright/test"
import assert from "node:assert/strict"

import { test } from "./application"
import { pinLanguage, web } from "./i18n"
import { createInvitedMember } from "./invited-member"
import { ADMIN, openDashboard } from "./log-in"

test("manager adds, processes, refreshes, and deletes a sitemap knowledge source", async ({
	page,
	agent,
	application,
}) => {
	const startUrl = `${application.providerOrigin}/knowledge/sitemap.xml`
	await openDashboard(page, ADMIN, `/dashboard/agent/${agent.id}?tab=context`)
	const input = page.getByLabel(web("agentWebsites.urlLabel"))
	await input.fill(startUrl)
	const added = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname === `/api/agents/${agent.id}/websites`,
	)
	await page.getByRole("button", { name: web("agentWebsites.addAction") }).click()
	expect((await added).status()).toBe(201)
	await expect(page.getByText(web("agentWebsites.status.pending"), { exact: true })).toBeVisible()
	await expect(page.getByText(web("agentWebsites.status.ready"), { exact: true })).toBeVisible({ timeout: 20_000 })
	const source = page.getByRole("link", { name: startUrl, exact: true })
	await expect(source).toBeVisible()

	const refreshed = page.waitForResponse(
		(response) =>
			response.request().method() === "POST" &&
			new URL(response.url()).pathname.endsWith("/refresh"),
	)
	await page.getByRole("button", { name: web("agentWebsites.refresh", { url: startUrl }) }).click()
	expect((await refreshed).status()).toBe(204)
	await expect(page.getByText(web("agentWebsites.status.ready"), { exact: true })).toBeVisible({ timeout: 20_000 })

	await page.getByRole("button", { name: web("agentWebsites.delete", { url: startUrl }) }).click()
	const confirmation = page.getByRole("alertdialog")
	await expect(confirmation).toContainText(web("agentWebsites.deletePrompt"))
	await expect(confirmation).toContainText(startUrl)
	await confirmation.getByRole("button", { name: web("agentWebsites.deleteConfirm") }).click()
	await expect(confirmation).toHaveCount(0)
	await expect(source).toHaveCount(0)
})

test("read-only operator can open a ready website without management controls", async ({
	browser,
	agent,
	application,
	adminRequest,
}) => {
	const startUrl = `${application.providerOrigin}/knowledge/sitemap.xml`
	const account = { username: crypto.randomUUID().replaceAll("-", ""), password: "website-reader-password" }
	await createInvitedMember(adminRequest, account)
	await expect(await adminRequest.post("/api/auth/login", { data: ADMIN })).toBeOK()
	const usersResponse = await adminRequest.get("/api/users")
	await expect(usersResponse).toBeOK()
	const { users } = (await usersResponse.json()) as { users: { id: string; username: string }[] }
	const user = users.find(({ username }) => username === account.username)
	assert(user, "Invited website reader is missing")
	const roleResponse = await adminRequest.post("/api/roles", {
		data: { name: `Website readers ${crypto.randomUUID()}`, permissions: [] },
	})
	await expect(roleResponse).toBeOK()
	const { role } = (await roleResponse.json()) as { role: { id: string } }
	const readerContext = await browser.newContext({ baseURL: application.origin })
	await pinLanguage(readerContext)
	try {
		await expect(
			await adminRequest.put(`/api/roles/${role.id}/agents/${agent.id}`, {
				data: { permissions: ["agents:read"] },
			}),
		).toBeOK()
		await expect(await adminRequest.put(`/api/users/${user.id}/roles`, { data: { roleIds: [role.id] } })).toBeOK()
		const added = await adminRequest.post(`/api/agents/${agent.id}/websites`, { data: { url: startUrl } })
		expect(added.status()).toBe(201)
		const reader = await readerContext.newPage()
		await openDashboard(reader, account, `/dashboard/agent/${agent.id}?tab=context`)

		await expect(reader.getByRole("link", { name: startUrl, exact: true })).toBeVisible()
		await expect(reader.getByText(web("agentWebsites.status.ready"), { exact: true })).toBeVisible({ timeout: 20_000 })
		await expect(reader.getByLabel(web("agentWebsites.urlLabel"))).toHaveCount(0)
		await expect(reader.getByRole("button", { name: web("agentWebsites.addAction") })).toHaveCount(0)
		await expect(reader.getByRole("button", { name: web("agentWebsites.refresh", { url: startUrl }) })).toHaveCount(0)
		await expect(reader.getByRole("button", { name: web("agentWebsites.delete", { url: startUrl }) })).toHaveCount(0)
	} finally {
		await readerContext.close()
		await expect(await adminRequest.delete(`/api/users/${user.id}`)).toBeOK()
		await expect(await adminRequest.delete(`/api/roles/${role.id}`)).toBeOK()
	}
})
