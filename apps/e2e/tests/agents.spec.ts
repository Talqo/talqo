import { expect, type Page, test } from "@playwright/test"

import { logIn } from "./log-in"

const OPERATOR = { username: "admin", password: "admin123" }
const VIEWER = { username: "user", password: "user1234" }
const MEMBER = VIEWER
const SEEDED_AGENT = "Website Assistant"

let createdAgentId: string | undefined

test.afterEach(async ({ page }) => {
	if (createdAgentId) await page.request.delete(`/api/agents/${createdAgentId}`)
	createdAgentId = undefined
})

async function giveViewerRole(page: Page): Promise<string> {
	await expect(await page.request.post("/api/auth/login", { data: OPERATOR })).toBeOK()
	const usersResponse = await page.request.get("/api/users")
	await expect(usersResponse).toBeOK()
	const { users } = (await usersResponse.json()) as { users: { id: string; username: string }[] }
	const user = users.find(({ username }) => username === VIEWER.username)
	if (!user) throw new Error("Seed user is missing")
	const response = await page.request.post("/api/roles", {
		data: { name: `Agent viewers ${Date.now()}`, permissions: ["agents:read"] },
	})
	await expect(response).toBeOK()
	const roleId = ((await response.json()) as { role: { id: string } }).role.id
	await expect(await page.request.put(`/api/users/${user.id}/roles`, { data: { roleIds: [roleId] } })).toBeOK()
	return roleId
}

// Deleting the role also removes the assignment.
async function removeViewerRole(page: Page, roleId: string): Promise<void> {
	await expect(await page.request.post("/api/auth/login", { data: OPERATOR })).toBeOK()
	await expect(await page.request.delete(`/api/roles/${roleId}`)).toBeOK()
}

test("manager creates, configures, and deletes an agent through the real API", async ({ page }) => {
	await logIn(page, OPERATOR)

	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()

	await page.getByRole("button", { name: "Create agent" }).click()
	await expect(page).toHaveURL(/\/dashboard\/agent\//)
	createdAgentId = new URL(page.url()).pathname.split("/").pop()
	await expect(page.getByRole("heading", { name: "Configure New agent" })).toBeVisible()
	await expect(page.getByLabel("Name")).toHaveValue("New agent")

	await page.getByLabel("Name").fill("Docs helper")
	await page.getByLabel("System prompt").fill("You answer questions from the product docs.")
	await page.getByLabel("Word blacklist").fill("spam")
	await page.getByRole("button", { name: "Add" }).click()
	await page.getByLabel("Word blacklist").fill("abuse")
	await page.getByLabel("Word blacklist").press("Enter")
	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	await page.getByRole("button", { name: "Remove abuse" }).click()
	await page.getByRole("button", { name: "Save changes" }).click()
	await page.reload()
	await expect(page.getByRole("heading", { name: "Configure Docs helper" })).toBeVisible()
	await expect(page.getByText("spam", { exact: true })).toBeVisible()
	await expect(page.getByText("abuse", { exact: true })).toHaveCount(0)

	// The merged statistics dashboard scopes everything through the agent multi-select box.
	await page.getByRole("link", { name: "Dashboard", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Welcome to Talqo" })).toBeVisible()
	await page.getByRole("combobox", { name: "Agents", exact: true }).click()
	await page.getByRole("button", { name: "Deselect all", exact: true }).click()
	await page.getByRole("option", { name: "Docs helper", exact: true }).click()
	await page.keyboard.press("Escape")
	await expect(page.getByRole("row", { name: /^Docs helper/ })).toBeVisible()

	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await page.getByRole("link", { name: /Docs helper/ }).click()
	await page.getByRole("button", { name: "Delete agent" }).click()
	const deleteDialog = page.getByRole("dialog")
	await expect(deleteDialog).toContainText("conversation and usage history")
	await expect(deleteDialog.getByRole("button", { name: "Delete permanently" })).toBeDisabled()
	await deleteDialog.getByPlaceholder("Docs helper").fill("Docs helper")
	const confirmButton = deleteDialog.getByRole("button", { name: "Delete permanently" })
	await expect(confirmButton).toBeEnabled()
	await confirmButton.click()
	await expect(page).toHaveURL("/dashboard/agents")
	await expect(page.getByRole("link", { name: /Docs helper/ })).toHaveCount(0)
	await page.reload()
	await expect(page.getByRole("link", { name: /Docs helper/ })).toHaveCount(0)
})

test("a read-only operator can inspect agents but finds no management controls", async ({ page }) => {
	const roleId = await giveViewerRole(page)
	try {
		await logIn(page, VIEWER)

		await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()
		await expect(page.getByRole("link", { name: "Analytics", exact: true })).toHaveCount(0)
		await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0)

		await page.getByRole("link", { name: "Agents", exact: true }).click()
		await expect(page.getByRole("button", { name: "Create agent" })).toHaveCount(0)
		await page.getByRole("link", { name: new RegExp(SEEDED_AGENT) }).click()

		await expect(page.getByRole("heading", { name: `Configure ${SEEDED_AGENT}` })).toBeVisible()
		await expect(page.getByLabel("Name")).toBeDisabled()
		await expect(page.getByLabel("System prompt")).toBeDisabled()
		await expect(page.getByText("Intercom", { exact: true })).toBeVisible()
		await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
		await expect(page.getByText("Danger zone")).toHaveCount(0)

		// Knowledge files are readable but not editable.
		await page.getByRole("tab", { name: "Context" }).click()
		await expect(page.getByRole("button", { name: "Download faq.md" })).toBeVisible()
		await expect(page.getByRole("button", { name: "Rename faq.md" })).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Delete faq.md" })).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Retry processing faq.md" })).toHaveCount(0)
		await expect(page.getByText("Drag files here, or click to browse")).toHaveCount(0)

		// Embeds ride on the same permission, so their controls must disappear too.
		await page.getByRole("tab", { name: "Embeds" }).click()
		await expect(page.getByRole("button", { name: "New embed" })).toHaveCount(0)
		await page.getByRole("link", { name: "Website", exact: true }).click()

		await expect(page.getByLabel("Name")).toBeDisabled()
		await expect(page.getByLabel("Brand color hex value", { exact: true })).toBeDisabled()
		await expect(page.locator("pre")).toBeVisible()
		await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
		await expect(page.getByText("Danger zone")).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Delete embed" })).toHaveCount(0)
	} finally {
		await removeViewerRole(page, roleId)
	}
})

test("an ungranted operator sees neither agent navigation nor agent content", async ({ page }) => {
	await logIn(page, MEMBER)

	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Analytics", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "AI configuration" })).toHaveCount(0)

	await page.goto("/dashboard/agents")
	await expect(page.getByText("Access restricted")).toBeVisible()

	// A hidden nav item is not an authorization boundary: a direct URL must deny, not blank.
	await page.goto("/dashboard/users")
	await expect(page.getByText("Access restricted")).toBeVisible()
	await expect(page.getByRole("button", { name: "Invite a member" })).toHaveCount(0)

	// Nested routes are covered by the same gate, not just top-level ones.
	await page.goto("/dashboard/ai-configuration")
	await expect(page.getByText("Access restricted")).toBeVisible()
	await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
})

test("switching accounts does not reuse cached agent permissions", async ({ page }) => {
	await logIn(page, OPERATOR)
	await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()

	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")

	let releasePermissions: (() => void) | undefined
	const permissionsReleased = new Promise<void>((resolve) => {
		releasePermissions = resolve
	})
	await page.route("**/api/me/permissions", async (route) => {
		await permissionsReleased
		await route.continue()
	})

	await page.getByLabel("Username").fill(MEMBER.username)
	await page.getByLabel("Password", { exact: true }).fill(MEMBER.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)

	releasePermissions?.()
})
