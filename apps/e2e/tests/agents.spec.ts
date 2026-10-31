import { expect } from "@playwright/test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { test } from "./application"
import { web } from "./i18n"
import { createInvitedMember } from "./invited-member"
import { ADMIN, logIn, logOut, MEMBER, openDashboard } from "./log-in"
import { WIDGET_APPEARANCE } from "./widget-appearance"

test("manager creates, configures, and deletes an agent through the real API", async ({ page }) => {
	const agentName = `Docs ${crypto.randomUUID()}`
	let createdAgentId: string | undefined
	try {
		await openDashboard(page, ADMIN, "/dashboard/agents")

		await expect(page.getByRole("heading", { name: web("agents.heading") })).toBeVisible()

		await page.getByRole("button", { name: web("agents.create") }).click()
		await expect(page).toHaveURL(/\/dashboard\/agent\//)
		createdAgentId = new URL(page.url()).pathname.split("/").pop()
		await expect(page.getByRole("heading", { name: web("agents.defaultName"), exact: true })).toBeVisible()
		await expect(page.getByLabel(web("agentFields.name"))).toHaveValue(web("agents.defaultName"))

		await page.getByLabel(web("agentFields.name")).fill(agentName)
		await page.getByLabel(web("agentFields.systemPrompt")).fill("You answer questions from the product docs.")
		await page.getByLabel(web("agentFields.wordBlacklist")).fill("spam")
		await page.getByRole("button", { name: web("blacklist.addTerm") }).click()
		await page.getByLabel(web("agentFields.wordBlacklist")).fill("abuse")
		await page.getByLabel(web("agentFields.wordBlacklist")).press("Enter")
		await page.getByRole("button", { name: web("agentConfig.save") }).click()
		await expect(page.getByText(web("agentConfig.saved"))).toBeVisible()

		await page.getByRole("button", { name: web("blacklist.removeTerm", { word: "abuse" }) }).click()
		const saved = page.waitForResponse(
			(response) =>
				response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/agents/${createdAgentId}`,
		)
		await page.getByRole("button", { name: web("agentConfig.save") }).click()
		expect((await saved).ok()).toBe(true)
		await page.reload()
		await expect(page.getByRole("heading", { name: agentName, exact: true })).toBeVisible()
		await expect(page.getByLabel(web("agentFields.systemPrompt"))).toHaveValue(
			"You answer questions from the product docs.",
		)
		await expect(page.getByText("spam", { exact: true })).toBeVisible()
		await expect(page.getByText("abuse", { exact: true })).toHaveCount(0)
		const termInput = page.getByPlaceholder(web("blacklist.termPlaceholder"))
		await termInput.fill("trial")
		await page.getByRole("button", { name: web("blacklist.addTerm") }).click()
		await expect(page.getByRole("button", { name: web("agentConfig.save") })).toBeEnabled()
		await page.getByRole("button", { name: web("blacklist.removeTerm", { word: "trial" }) }).click()
		await expect(page.getByRole("button", { name: web("agentConfig.save") })).toBeDisabled()

		await page.getByRole("link", { name: web("nav.agents"), exact: true }).click()
		await page.getByRole("link", { name: new RegExp(agentName) }).click()
		await page.getByLabel(web("agentFields.systemPrompt")).fill("Unsaved prompt edit")
		await page.getByRole("button", { name: web("agentConfig.deleteAgent") }).click()
		const deleteDialog = page.getByRole("alertdialog")
		await expect(deleteDialog).toContainText(web("agentConfig.deletePrompt", { name: agentName }))
		await expect(deleteDialog.getByRole("button", { name: web("agentConfig.deleteConfirm") })).toBeDisabled()
		const typedName = deleteDialog.getByPlaceholder(agentName)
		const confirmButton = deleteDialog.getByRole("button", { name: web("agentConfig.deleteConfirm") })
		await typedName.fill(agentName)
		await expect(confirmButton).toBeEnabled()
		await deleteDialog.getByRole("button", { name: web("agentConfig.cancel"), exact: true }).click()
		await page.getByRole("button", { name: web("agentConfig.deleteAgent") }).click()
		await expect(typedName).toHaveValue("")
		await expect(confirmButton).toBeDisabled()
		await typedName.fill(agentName)
		await expect(confirmButton).toBeEnabled()
		await confirmButton.click()
		await expect(page).toHaveURL("/dashboard/agents")
		await expect(page.getByRole("link", { name: new RegExp(agentName) })).toHaveCount(0)
		await page.reload()
		await expect(page.getByRole("link", { name: new RegExp(agentName) })).toHaveCount(0)
		createdAgentId = undefined
	} finally {
		// oxlint-disable-next-line playwright/no-conditional-in-test, playwright/no-conditional-expect -- Cleanup must handle partially completed journeys.
		if (createdAgentId) await expect(await page.request.delete(`/api/agents/${createdAgentId}`)).toBeOK()
	}
})

test("a read-only operator can inspect agents but finds no management controls", async ({ page, agent }) => {
	const viewer = { username: crypto.randomUUID().replaceAll("-", ""), password: "viewer-test-password" }
	await createInvitedMember(page.request, viewer)
	await expect(await page.request.post("/api/auth/login", { data: ADMIN })).toBeOK()
	const usersResponse = await page.request.get("/api/users")
	await expect(usersResponse).toBeOK()
	const { users } = (await usersResponse.json()) as { users: { id: string; username: string }[] }
	const user = users.find(({ username }) => username === viewer.username)
	assert(user, "Invited viewer is missing")
	const roleResponse = await page.request.post("/api/roles", {
		data: { name: `Agent viewers ${Date.now()}`, permissions: [] },
	})
	await expect(roleResponse).toBeOK()
	const roleId = ((await roleResponse.json()) as { role: { id: string } }).role.id
	let filePath: string | undefined
	try {
		const agentsResponse = await page.request.get("/api/agents")
		await expect(agentsResponse).toBeOK()
		const { agents } = (await agentsResponse.json()) as { agents: { id: string; name: string }[] }
		const hidden = agents.find(({ name }) => name === "Product Advisor")
		assert(hidden, "Missing reporting-only agent")
		await expect(
			await page.request.put(`/api/roles/${roleId}/agents/${hidden.id}`, { data: { permissions: ["stats:read"] } }),
		).toBeOK()
		await expect(
			await page.request.put(`/api/roles/${roleId}/agents/${agent.id}`, { data: { permissions: ["agents:read"] } }),
		).toBeOK()
		await expect(await page.request.put(`/api/users/${user.id}/roles`, { data: { roleIds: [roleId] } })).toBeOK()
		const embedResponse = await page.request.post("/api/embeds", {
			data: { name: "Website", agentId: agent.id, appearance: WIDGET_APPEARANCE },
		})
		await expect(embedResponse).toBeOK()
		const upload = await page.request.post(`/api/agents/${agent.id}/files`, {
			multipart: { file: { name: "reader-guide.md", mimeType: "text/markdown", buffer: Buffer.from("Reader guide") } },
		})
		await expect(upload).toBeOK()
		filePath = `/api/agents/${agent.id}/files/reader-guide.md`
		await openDashboard(page, viewer, "/dashboard/agents")

		await expect(page.getByRole("link", { name: web("nav.agents"), exact: true })).toBeVisible()
		await expect(page.getByRole("link", { name: web("nav.team"), exact: true })).toHaveCount(0)

		await expect(page.getByRole("button", { name: web("agents.create") })).toHaveCount(0)
		await expect(page.getByRole("link", { name: /Product Advisor/ })).toHaveCount(0)
		await page.goto(`/dashboard/agent/${hidden.id}`)
		await expect(page).toHaveURL("/dashboard/agents")
		await page.getByRole("link", { name: new RegExp(agent.name) }).click()

		await expect(page.getByRole("heading", { name: agent.name, exact: true })).toBeVisible()
		await expect(page.getByLabel(web("agentFields.name"))).toHaveAttribute("readonly", "")
		await expect(page.getByLabel(web("agentFields.systemPrompt"))).toHaveAttribute("readonly", "")
		await expect(page.getByRole("button", { name: web("blacklist.addTerm"), exact: true })).toHaveCount(0)
		await expect(page.getByText("Intercom", { exact: true })).toBeVisible()
		await expect(page.getByRole("button", { name: web("agentConfig.save") })).toHaveCount(0)
		await expect(page.getByText(web("agentConfig.dangerZone"))).toHaveCount(0)

		await page.getByRole("tab", { name: web("agentConfig.tabContext") }).click()
		const downloadPromise = page.waitForEvent("download")
		await page.getByRole("button", { name: web("agentFiles.download", { name: "reader-guide.md" }) }).click()
		const download = await downloadPromise
		expect(download.suggestedFilename()).toBe("reader-guide.md")
		const downloadedPath = await download.path()
		assert(downloadedPath, "Knowledge file download failed")
		expect(await readFile(downloadedPath, "utf8")).toBe("Reader guide")
		await expect(page.getByRole("button", { name: web("agentFiles.rename", { name: "reader-guide.md" }) })).toHaveCount(
			0,
		)
		await expect(page.getByRole("button", { name: web("agentFiles.delete", { name: "reader-guide.md" }) })).toHaveCount(
			0,
		)
		await expect(page.getByRole("button", { name: web("agentFiles.retry", { name: "reader-guide.md" }) })).toHaveCount(
			0,
		)
		await expect(page.getByText(web("agentFiles.dropzone"))).toHaveCount(0)

		await page.getByRole("tab", { name: web("agentConfig.tabEmbeds") }).click()
		await expect(page.getByRole("link", { name: "Website", exact: true })).toBeVisible()
		await expect(page.getByRole("switch", { name: web("embedSetup.embedEnabled") })).toBeDisabled()
		await expect(page.getByRole("switch", { name: web("embedSetup.embedEnabled") })).toBeChecked()
		await expect(page.getByRole("button", { name: web("embedSetup.createEmbed") })).toHaveCount(0)
		await page.getByRole("link", { name: "Website", exact: true }).click()

		await expect(page.getByLabel(web("embedSetup.nameLabel"))).toHaveAttribute("readonly", "")
		await expect(
			page.getByLabel(web("embedSetup.hexValue", { label: web("embedSetup.colorPrimary") }), { exact: true }),
		).toHaveAttribute("readonly", "")
		await expect(page.locator("pre")).toBeVisible()
		await expect(page.getByRole("button", { name: web("embedSetup.save") })).toHaveCount(0)
		await expect(page.getByText(web("embedSetup.dangerZone"))).toHaveCount(0)
		await expect(page.getByRole("button", { name: web("embedSetup.deleteEmbed") })).toHaveCount(0)
	} finally {
		await expect(await page.request.post("/api/auth/login", { data: ADMIN })).toBeOK()
		await expect(await page.request.delete(`/api/users/${user.id}`)).toBeOK()
		await expect(await page.request.delete(`/api/roles/${roleId}`)).toBeOK()
		// oxlint-disable-next-line playwright/no-conditional-in-test, playwright/no-conditional-expect -- The upload may fail before a file exists to clean up.
		if (filePath) await expect(await page.request.delete(filePath)).toBeOK()
	}
})

test("an ungranted operator sees neither agent navigation nor agent content", async ({ page }) => {
	await logIn(page, MEMBER)
	await expect(page).toHaveURL("/dashboard/account")

	await expect(page.getByRole("link", { name: web("nav.agents"), exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: web("nav.team"), exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: web("nav.aiConfiguration") })).toHaveCount(0)

	await page.goto("/dashboard/agents")
	await expect(page).toHaveURL("/dashboard/account")
	await page.goto(`/dashboard/embeds/${crypto.randomUUID()}`)
	await expect(page).toHaveURL("/dashboard/account")

	// A hidden nav item is not an authorization boundary: a direct URL must deny, not blank.
	await page.goto("/dashboard/users")
	await expect(page).toHaveURL("/dashboard/account")
	await expect(page.getByRole("button", { name: web("auth.invitations.heading") })).toHaveCount(0)

	// Nested routes are covered by the same gate, not just top-level ones.
	await page.goto("/dashboard/ai-configuration")
	await expect(page).toHaveURL("/dashboard/account")
	await expect(page.getByRole("button", { name: web("agentConfig.save") })).toHaveCount(0)
})

test("switching accounts does not reuse cached agent permissions", async ({ page }) => {
	await logIn(page)
	await expect(page.getByRole("link", { name: web("nav.agents"), exact: true })).toBeVisible()

	await logOut(page)

	const permissionsRequested = Promise.withResolvers<void>()
	const releasePermissions = Promise.withResolvers<void>()
	await page.route("**/api/me/permissions", async (route) => {
		permissionsRequested.resolve()
		await releasePermissions.promise
		await route.continue()
	})
	try {
		await page.getByLabel(web("auth.credentialsForm.username")).fill(MEMBER.username)
		await page.getByLabel(web("auth.credentialsForm.password"), { exact: true }).fill(MEMBER.password)
		await page.getByRole("button", { name: web("auth.login.submit") }).click()
		await permissionsRequested.promise
		await expect(page).toHaveURL("/dashboard")
		await expect(page.getByRole("link", { name: web("nav.agents"), exact: true })).toHaveCount(0)
	} finally {
		releasePermissions.resolve()
		await page.unrouteAll({ behavior: "wait" })
	}
	await expect(page).toHaveURL("/dashboard/account")
	await expect(page.getByRole("link", { name: web("nav.agents"), exact: true })).toHaveCount(0)
})

test("agent tabs scroll inside their strip at 320px", async ({ page, agent }) => {
	await page.setViewportSize({ width: 320, height: 720 })
	await openDashboard(page, ADMIN, `/dashboard/agent/${agent.id}`)

	const strip = page.getByRole("tablist")
	await expect(strip).toBeVisible()
	await expect(page.getByRole("tab", { name: web("agentConfig.tabConfiguration") })).toBeVisible()

	const { clientWidth, scrollWidth } = await page.evaluate(() => ({
		clientWidth: document.documentElement.clientWidth,
		scrollWidth: document.documentElement.scrollWidth,
	}))
	expect(scrollWidth).toBeLessThanOrEqual(clientWidth)
	expect(await strip.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
})
