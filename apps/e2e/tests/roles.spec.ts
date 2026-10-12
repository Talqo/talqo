import { expect, test, type Page } from "@playwright/test"

const ADMIN = { username: "admin", password: "admin123" }

async function logIn(page: Page, account: { password: string; username: string }) {
	await page.goto("/login")
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
}

async function logOut(page: Page) {
	await page.getByRole("button", { name: "Log out" }).click()
	await expect(page).toHaveURL("/login")
}

// Disposable operator, so the journey never changes the shared seed accounts.
async function inviteOperator(page: Page, account: { password: string; username: string }) {
	await page.getByRole("link", { name: "Users", exact: true }).click()
	await page.getByRole("button", { name: "Invite a member" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByRole("button", { name: "Create invitation" }).click()
	const inviteUrl = await dialog.getByLabel("Invitation link:").inputValue()
	const token = new URL(inviteUrl).searchParams.get("token")
	if (!token) throw new Error(`Could not find an invitation token in URL: ${inviteUrl}`)
	// The dialog is modal, so close it before reaching the header controls.
	await page.keyboard.press("Escape")
	await logOut(page)

	await page.goto(`/accept-invite?token=${token}`)
	await page.getByLabel("Username").fill(account.username)
	await page.getByLabel("Password", { exact: true }).fill(account.password)
	await page.getByLabel("Confirm password").fill(account.password)
	await page.getByRole("button", { name: "Create account" }).click()
	await expect(page).toHaveURL("/dashboard")
}

test("an admin gives an invited operator a role and the dashboard follows it", async ({ page }) => {
	const roleName = `Agent editors ${Date.now()}`
	const operator = { username: `operator_${Date.now()}`, password: "operator-role-password" }

	await test.step("the admin creates a role that can manage agents", async () => {
		await logIn(page, ADMIN)
		await page.getByRole("link", { name: "Roles", exact: true }).click()
		await page.getByRole("button", { name: "Create role" }).click()
		const dialog = page.getByRole("dialog")
		await dialog.getByLabel("Name").fill(roleName)
		await dialog.getByLabel("Manage agents").check()
		await expect(dialog.getByLabel("See agents")).toBeChecked()
		await dialog.getByRole("button", { name: "Save role" }).click()
		await expect(dialog).toBeHidden()
		await expect(page.locator("[data-role-id]", { hasText: roleName })).toContainText("People with this role: 0")
	})

	await test.step("an invited operator starts without access", async () => {
		await inviteOperator(page, operator)
		await expect(page.getByRole("link", { name: "Agents", exact: true })).toHaveCount(0)
		await logOut(page)
	})

	await test.step("the admin assigns the role on the Users page", async () => {
		await logIn(page, ADMIN)
		await page.getByRole("link", { name: "Users", exact: true }).click()
		const operatorCard = page.locator("[data-user-id]", { hasText: operator.username })
		await operatorCard.getByRole("button", { name: "Edit roles" }).click()
		const dialog = page.getByRole("dialog")
		await dialog.getByLabel(roleName).check()
		await dialog.getByRole("button", { name: "Save roles" }).click()
		await expect(dialog).toBeHidden()
		await expect(operatorCard).toContainText(roleName)
		await logOut(page)
	})

	await test.step("the operator can manage agents but nothing else", async () => {
		await logIn(page, operator)
		await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible()
		await expect(page.getByRole("link", { name: "AI configuration", exact: true })).toHaveCount(0)
		await expect(page.getByRole("link", { name: "Roles", exact: true })).toHaveCount(0)
		await expect(page.getByRole("link", { name: "Users", exact: true })).toHaveCount(0)

		await page.getByRole("link", { name: "Agents", exact: true }).click()
		await expect(page.getByRole("button", { name: "Create agent" })).toBeVisible()

		// A hidden link is not the boundary: the page itself must refuse.
		await page.goto("/dashboard/roles")
		await expect(page.getByText("Access restricted")).toBeVisible()
		await expect(page.getByRole("button", { name: "Create role" })).toHaveCount(0)
		await logOut(page)
	})

	await test.step("the admin removes the operator and the role", async () => {
		await logIn(page, ADMIN)
		await page.getByRole("link", { name: "Users", exact: true }).click()
		const operatorCard = page.locator("[data-user-id]", { hasText: operator.username })
		await operatorCard.getByRole("button", { name: "Delete", exact: true }).click()
		const deleteUser = page.getByRole("dialog")
		await deleteUser.getByLabel(`Type "${operator.username}" to enable deletion`).fill(operator.username)
		await deleteUser.getByRole("button", { name: "Delete permanently" }).click()
		await expect(operatorCard).toHaveCount(0)

		await page.getByRole("link", { name: "Roles", exact: true }).click()
		const roleCard = page.locator("[data-role-id]", { hasText: roleName })
		await roleCard.getByRole("button", { name: "Delete", exact: true }).click()
		await page.getByRole("dialog").getByRole("button", { name: "Delete role" }).click()
		await expect(roleCard).toHaveCount(0)
	})
})
