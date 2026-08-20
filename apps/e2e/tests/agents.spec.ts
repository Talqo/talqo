import { expect, test } from "@playwright/test"

const operator = {
	username: process.env.E2E_OPERATOR_USERNAME,
	password: process.env.E2E_OPERATOR_PASSWORD,
}

test.beforeEach(async ({ page }) => {
	if (!operator.username || !operator.password) {
		throw new Error("E2E_OPERATOR_* missing — scripts/test-e2e.ts provides them from the API seed")
	}
	await page.goto("/login")
	await page.getByLabel("Username").fill(operator.username)
	await page.getByLabel("Password", { exact: true }).fill(operator.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")
})

test("agent journey: create, configure, and pause", async ({ page }) => {
	await page.goto("/dashboard/agents")
	await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()
	await expect(page.locator("[data-slot=card]", { hasText: "Docs helper" })).toBeVisible()

	await page.getByRole("button", { name: "Create agent" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Name").fill("Billing helper")
	await dialog.getByLabel("System prompt").fill("You answer billing questions.")
	await dialog.getByLabel("Word blacklist").fill("spam, abuse")
	await dialog.getByRole("button", { name: "Create agent" }).click()

	const card = page.locator("[data-slot=card]", { hasText: "Billing helper" })
	await expect(card).toBeVisible()
	await expect(card.getByText("spam", { exact: true })).toHaveCount(0)

	await card.getByRole("button", { name: "Configure" }).click()
	await expect(page.getByRole("heading", { name: "Configure Billing helper" })).toBeVisible()
	await expect(page.getByText("spam", { exact: true })).toBeVisible()
	await page.getByLabel("Name").fill("Billing helper 2")
	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	// Persisted server-side now, so a reload must still show the new name.
	await page.reload()
	await expect(page.getByRole("heading", { name: "Configure Billing helper 2" })).toBeVisible()

	await page.getByRole("button", { name: "Back to agents" }).click()
	const updated = page.locator("[data-slot=card]", { hasText: "Billing helper 2" })
	await updated.getByRole("switch").click()
	await expect(updated.getByRole("switch")).toHaveAttribute("aria-checked", "false")
})

test("account security controls stay disabled until the account API exists", async ({ page }) => {
	await page.goto("/dashboard/account")
	await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
	await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(2)
	await expect(page.getByLabel("Current password")).toBeDisabled()
	await expect(page.getByLabel("New password", { exact: true })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Delete account" })).toBeDisabled()
})
