import { expect, test, type Page } from "@playwright/test"

const OPERATOR = { username: "admin", password: "admin123" }
const VIEWER = { username: "user", password: "user1234" }
const MEMBER = VIEWER
const SEEDED_AGENT = "Website Assistant"

async function grantViewerPermission(page: Page): Promise<string> {
	await expect(await page.request.post("/api/auth/login", { data: OPERATOR })).toBeOK()
	const usersResponse = await page.request.get("/api/users")
	await expect(usersResponse).toBeOK()
	const { users } = (await usersResponse.json()) as { users: { id: string; username: string }[] }
	const user = users.find(({ username }) => username === VIEWER.username)
	if (!user) throw new Error("Seed user is missing")
	const response = await page.request.post("/api/permission-grants", {
		data: { userId: user.id, permission: "agents:read" },
	})
	await expect(response).toBeOK()
	return ((await response.json()) as { grant: { id: string } }).grant.id
}

async function revokeViewerPermission(page: Page, grantId: string): Promise<void> {
	await expect(await page.request.post("/api/auth/login", { data: OPERATOR })).toBeOK()
	await expect(await page.request.delete(`/api/permission-grants/${grantId}`)).toBeOK()
}

async function logIn(page: Page, account: { password: string; username: string }) {
	await page.goto("/login")
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}

test("manager creates, configures, and deletes an agent through the real API", async ({ page }) => {
	await logIn(page, OPERATOR)

	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()
	await expect(page.getByRole("link", { name: new RegExp(SEEDED_AGENT) })).toBeVisible()

	await page.getByRole("button", { name: "Create agent" }).click()
	await expect(page).toHaveURL(/\/dashboard\/agent\//)
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

	await expect(page.getByLabel("Embed token", { exact: true })).toHaveCount(0)

	await page.getByRole("link", { name: "Analytics", exact: true }).click()
	await page.getByRole("combobox", { name: "Select an agent" }).click()
	await page.getByRole("option", { name: "Docs helper" }).click()
	await expect(page.getByText("Conversations (30 days)")).toBeVisible()

	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await page.getByRole("link", { name: /Docs helper/ }).click()
	await page.getByRole("button", { name: "Delete agent" }).click()
	const deleteDialog = page.getByRole("dialog")
	await expect(deleteDialog.getByRole("button", { name: "Delete permanently" })).toBeDisabled()
	await deleteDialog.getByPlaceholder("Docs helper").fill("Docs helper")
	const confirmButton = deleteDialog.getByRole("button", { name: "Delete permanently" })
	await expect(confirmButton).toBeEnabled()
	await confirmButton.click()
	await expect(page).toHaveURL("/dashboard/agents")
	await expect(page.getByRole("link", { name: /Docs helper/ })).toHaveCount(0)
	await page.reload()
	await expect(page.getByRole("link", { name: /Docs helper/ })).toHaveCount(0)
	await expect(page.getByRole("link", { name: new RegExp(SEEDED_AGENT) })).toBeVisible()
})

test("a read-only operator can inspect agents but finds no management controls", async ({ page }) => {
	const grantId = await grantViewerPermission(page)
	try {
		await logIn(page, VIEWER)

		await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()
		await expect(page.getByRole("link", { name: "Analytics", exact: true })).toBeVisible()
		await expect(page.getByRole("link", { name: "Invitations", exact: true })).toHaveCount(0)

		await page.getByRole("link", { name: "Agents", exact: true }).click()
		await expect(page.getByRole("button", { name: "Create agent" })).toHaveCount(0)
		await page.getByRole("link", { name: new RegExp(SEEDED_AGENT) }).click()

		await expect(page.getByRole("heading", { name: `Configure ${SEEDED_AGENT}` })).toBeVisible()
		await expect(page.getByLabel("Name")).toBeDisabled()
		await expect(page.getByLabel("System prompt")).toBeDisabled()
		await expect(page.getByText("Intercom", { exact: true })).toBeVisible()
		await expect(page.getByLabel("Embed token", { exact: true })).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
		await expect(page.getByText("Danger zone")).toHaveCount(0)

		// Embeds ride on the same permission, so their controls must disappear too.
		await page.getByRole("tab", { name: "Embeds" }).click()
		await expect(page.getByRole("button", { name: "New embed" })).toHaveCount(0)
		await page.locator("[data-slot=card]", { hasText: "Website" }).click()

		await expect(page.getByLabel("Name")).toBeDisabled()
		await expect(page.getByLabel("Brand color hex value", { exact: true })).toBeDisabled()
		await expect(page.locator("pre")).toBeVisible()
		await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0)
		await expect(page.getByText("Danger zone")).toHaveCount(0)
		await expect(page.getByRole("button", { name: "Delete embed" })).toHaveCount(0)
	} finally {
		await revokeViewerPermission(page, grantId)
	}
})

test("an ungranted operator sees neither agent navigation nor agent content", async ({ page }) => {
	await logIn(page, MEMBER)

	await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Analytics", exact: true })).toHaveCount(0)
	await expect(page.getByRole("link", { name: "Invitations", exact: true })).toHaveCount(0)

	await page.goto("/dashboard/agents")
	await expect(page.getByText("Access restricted")).toBeVisible()
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

test("account deletion stays disabled until the account deletion API exists", async ({ page }) => {
	await logIn(page, OPERATOR)
	await page.goto("/dashboard/account")
	await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
	await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(1)
	await expect(page.getByRole("button", { name: "Delete account" })).toBeDisabled()
})
