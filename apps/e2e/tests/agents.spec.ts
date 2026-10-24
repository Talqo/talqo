import { expect } from "@playwright/test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { test } from "./application"
import { createInvitedMember } from "./invited-member"
import { ADMIN, logIn, MEMBER, openDashboard } from "./log-in"
import { WIDGET_APPEARANCE } from "./widget-appearance"

test("manager creates, configures, and deletes an agent through the real API", async ({ page }) => {
	const agentName = `Docs ${crypto.randomUUID()}`
	let createdAgentId: string | undefined
	try {
		await openDashboard(page)

		await page.getByRole("link", { name: "Agents", exact: true }).click()
		await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()

		await page.getByRole("button", { name: "Create agent" }).click()
		await expect(page).toHaveURL(/\/dashboard\/agent\//)
		createdAgentId = new URL(page.url()).pathname.split("/").pop()
		await expect(page.getByRole("heading", { name: "New agent", exact: true })).toBeVisible()
		await expect(page.getByLabel("Name")).toHaveValue("New agent")

		await page.getByLabel("Name").fill(agentName)
		await page.getByLabel("System prompt").fill("You answer questions from the product docs.")
		await page.getByLabel("Word blacklist").fill("spam")
		await page.getByRole("button", { name: "Add" }).click()
		await page.getByLabel("Word blacklist").fill("abuse")
		await page.getByLabel("Word blacklist").press("Enter")
		await page.getByRole("button", { name: "Save changes" }).click()
		await expect(page.getByText("Saved just now.")).toBeVisible()

		await page.getByRole("button", { name: "Remove abuse" }).click()
		const saved = page.waitForResponse(
			(response) =>
				response.request().method() === "PUT" && new URL(response.url()).pathname === `/api/agents/${createdAgentId}`,
		)
		await page.getByRole("button", { name: "Save changes" }).click()
		expect((await saved).ok()).toBe(true)
		await page.reload()
		await expect(page.getByRole("heading", { name: agentName, exact: true })).toBeVisible()
		await expect(page.getByLabel("System prompt")).toHaveValue("You answer questions from the product docs.")
		await expect(page.getByText("spam", { exact: true })).toBeVisible()
		await expect(page.getByText("abuse", { exact: true })).toHaveCount(0)

		await page.getByRole("link", { name: "Agents", exact: true }).click()
		await page.getByRole("link", { name: new RegExp(agentName) }).click()
		await page.getByRole("button", { name: "Delete agent" }).click()
		const deleteDialog = page.getByRole("dialog")
		await expect(deleteDialog).toContainText("conversation and usage history")
		await expect(deleteDialog.getByRole("button", { name: "Delete permanently" })).toBeDisabled()
		await deleteDialog.getByPlaceholder(agentName).fill(agentName)
		const confirmButton = deleteDialog.getByRole("button", { name: "Delete permanently" })
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
			await page.request.put(`/api/agents/${hidden.id}/access/${roleId}`, { data: { permissions: ["stats:read"] } }),
		).toBeOK()
		await expect(
			await page.request.put(`/api/agents/${agent.id}/access/${roleId}`, { data: { permissions: ["agents:read"] } }),
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
		await openDashboard(page, viewer)

		await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()
		await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0)

		await page.getByRole("link", { name: "Agents", exact: true }).click()
		await expect(page.getByRole("button", { name: "Create agent" })).toHaveCount(0)
		await expect(page.getByRole("link", { name: /Product Advisor/ })).toHaveCount(0)
		await page.goto(`/dashboard/agent/${hidden.id}`)
		await expect(page).toHaveURL("/dashboard/agents")
		await page.getByRole("link", { name: new RegExp(agent.name) }).click()

		await expect(page.getByRole("heading", { name: agent.name, exact: true })).toBeVisible()
		await expect(page.getByLabel("Name")).toHaveAttribute("readonly", "")
		await expect(page.getByLabel("System prompt")).toHaveAttribute("readonly", "")
		await expect(page.getByRole("button", { name: "Add", exact: true })).toHaveCount(0)
		await expect(page.getByText("Intercom", { exact: true })).toBeVisible()
		await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
		await expect(page.getByText("Danger zone")).toHaveCount(0)

		await page.getByRole("tab", { name: "Context" }).click()
		const downloadPromise = page.waitForEvent("download")
		await page.getByRole("button", { name: "Download reader-guide.md" }).click()
		const download = await downloadPromise
		expect(download.suggestedFilename()).toBe("reader-guide.md")
		const downloadedPath = await download.path()
		assert(downloadedPath, "Knowledge file download failed")
		expect(await readFile(downloadedPath, "utf8")).toBe("Reader guide")
		await expect(page.getByRole("button", { name: "Rename reader-guide.md" })).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Delete reader-guide.md" })).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Retry processing reader-guide.md" })).toHaveCount(0)
		await expect(page.getByText("Drag files here, or click to browse")).toHaveCount(0)

		await page.getByRole("tab", { name: "Embeds" }).click()
		await expect(page.getByRole("link", { name: "Website", exact: true })).toBeVisible()
		await expect(page.getByRole("switch", { name: "Embed enabled" })).toBeDisabled()
		await expect(page.getByRole("switch", { name: "Embed enabled" })).toBeChecked()
		await expect(page.getByRole("button", { name: "New embed" })).toHaveCount(0)
		await page.getByRole("link", { name: "Website", exact: true }).click()

		await expect(page.getByLabel("Name")).toHaveAttribute("readonly", "")
		await expect(page.getByLabel("Brand color hex value", { exact: true })).toHaveAttribute("readonly", "")
		await expect(page.locator("pre")).toBeVisible()
		await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
		await expect(page.getByText("Danger zone")).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Delete embed" })).toHaveCount(0)
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

	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "AI configuration" })).toHaveCount(0)

	await page.goto("/dashboard/agents")
	await expect(page).toHaveURL("/dashboard/account")
	await page.goto(`/dashboard/embeds/${crypto.randomUUID()}`)
	await expect(page).toHaveURL("/dashboard/account")

	// A hidden nav item is not an authorization boundary: a direct URL must deny, not blank.
	await page.goto("/dashboard/users")
	await expect(page).toHaveURL("/dashboard/account")
	await expect(page.getByRole("button", { name: "Invite a member" })).toHaveCount(0)

	// Nested routes are covered by the same gate, not just top-level ones.
	await page.goto("/dashboard/ai-configuration")
	await expect(page).toHaveURL("/dashboard/account")
	await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
})

test("switching accounts does not reuse cached agent permissions", async ({ page }) => {
	await logIn(page)
	await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()

	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")

	const permissionsRequested = Promise.withResolvers<void>()
	const releasePermissions = Promise.withResolvers<void>()
	await page.route("**/api/me/permissions", async (route) => {
		permissionsRequested.resolve()
		await releasePermissions.promise
		await route.continue()
	})
	try {
		await page.getByLabel("Username").fill(MEMBER.username)
		await page.getByLabel("Password", { exact: true }).fill(MEMBER.password)
		await page.getByRole("button", { name: "Log in" }).click()
		await permissionsRequested.promise
		await expect(page).toHaveURL("/dashboard")
		await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
	} finally {
		releasePermissions.resolve()
		await page.unrouteAll({ behavior: "wait" })
	}
	await expect(page).toHaveURL("/dashboard/account")
	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
})
