import { expect, test } from "@playwright/test"

import { loginAsAdmin } from "./helpers"

test("agent journey: create, configure, upload context file, pause, and embed", async ({ page }) => {
	await loginAsAdmin(page)
	await page.goto("/dashboard/agents")
	await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible()
	// The list is fetched live from the API now: wait for the fetch to settle into the empty state.
	await expect(page.getByText("Loading agents…")).toHaveCount(0)
	await expect(page.getByText("No agents yet.")).toBeVisible()

	await page.getByRole("button", { name: "Create agent" }).click()
	const dialog = page.getByRole("dialog")
	await dialog.getByLabel("Name").fill("Docs helper")
	await dialog.getByLabel("System prompt").fill("You answer questions from the product docs.")
	await dialog.getByLabel("Word blacklist").fill("spam, abuse")
	await dialog.getByRole("button", { name: "Create agent" }).click()

	const card = page.locator("[data-slot=card]", { hasText: "Docs helper" })
	await expect(card).toBeVisible()
	await expect(card.getByText("spam", { exact: true })).toHaveCount(0)
	await expect(card.getByText(/answer questions/)).toHaveCount(0)

	await card.getByRole("button", { name: "Configure" }).click()
	await expect(page.getByRole("heading", { name: "Configure Docs helper" })).toBeVisible()
	await expect(page.getByText("spam", { exact: true })).toBeVisible()
	await page.getByLabel("Name").fill("Docs helper 2")
	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	// Upload a context file, rename it, verify it is listed, then delete it.
	await expect(page.getByText("No files uploaded yet.")).toBeVisible()
	const fileChooserPromise = page.waitForEvent("filechooser")
	await page.getByRole("button", { name: "Upload file", exact: true }).click()
	const fileChooser = await fileChooserPromise
	// Deliberately long name: the list must truncate instead of breaking the layout.
	await fileChooser.setFiles({
		name: "quarterly-refund-policy-and-return-instructions-for-all-regions.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("Refunds are available within 30 days of purchase."),
	})
	await expect(page.getByText(/quarterly-refund-policy/)).toBeVisible()

	// Rename via the pencil button: extension is preserved automatically.
	await page.getByRole("button", { name: "Rename" }).click()
	const renameDialog = page.getByRole("dialog")
	await renameDialog.getByLabel("File name").fill("Refund rules")
	await renameDialog.getByRole("button", { name: "Rename" }).click()
	await expect(page.getByText("Refund rules.txt")).toBeVisible()

	// Re-upload the long-named file so the delete dialog has to render it.
	const deleteChooserPromise = page.waitForEvent("filechooser")
	await page.getByRole("button", { name: "Upload file", exact: true }).click()
	const secondChooser = await deleteChooserPromise
	await secondChooser.setFiles({
		name: "quarterlyrefundpolicyandreturninstructionsforallregionsunabridgededition.txt",
		mimeType: "text/plain",
		buffer: Buffer.from("Refunds are available within 30 days of purchase."),
	})
	await expect(page.getByText(/quarterlyrefundpolicy/)).toBeVisible()

	await page.getByRole("button", { name: "Delete" }).first().click()
	// The long unbroken name must stay inside the dialog popup, not overflow its ring/border.
	const popup = page.locator("[data-slot=dialog-content]")
	await expect(popup).toBeVisible()
	const description = popup.locator("[data-slot=dialog-description]")
	const [popupBox, descriptionBox] = await Promise.all([popup.boundingBox(), description.boundingBox()])
	if (!popupBox || !descriptionBox) throw new Error("Could not measure the delete dialog geometry")
	expect(descriptionBox.x).toBeGreaterThanOrEqual(popupBox.x)
	expect(descriptionBox.x + descriptionBox.width).toBeLessThanOrEqual(popupBox.x + popupBox.width)
	// And the dialog must not overflow the viewport.
	const viewport = page.viewportSize()
	if (!viewport) throw new Error("No viewport size")
	expect(popupBox.width).toBeLessThanOrEqual(viewport.width)
	await popup.getByRole("button", { name: "Delete" }).click()
	// Deleting "Refund rules.txt" too: assert each row disappears instead of juggling dialogs.
	await page.getByRole("button", { name: "Delete" }).click()
	await page.locator("[data-slot=dialog-content]").getByRole("button", { name: "Delete" }).click()
	await expect(page.getByText("No files uploaded yet.")).toBeVisible()

	await page.getByRole("button", { name: "Back to agents" }).click()
	const updated = page.locator("[data-slot=card]", { hasText: "Docs helper 2" })
	await expect(updated).toBeVisible()
	await updated.getByRole("switch").click()
	await expect(updated.getByRole("switch")).toHaveAttribute("aria-checked", "false")

	await page.getByRole("link", { name: "Widget", exact: true }).click()
	await page.getByLabel("Agent").click()
	await page.getByRole("option", { name: "Docs helper 2" }).click()
	const widgetCdnUrl = process.env.E2E_WIDGET_CDN_URL
	if (!widgetCdnUrl) throw new Error("E2E_WIDGET_CDN_URL missing — playwright.config.ts provides it")
	const snippet = page.locator("pre")
	await expect(snippet).toContainText(`src="${widgetCdnUrl}"`)
	// Agent ids are server-generated UUIDs now: only assert the attribute is present.
	await expect(snippet).toContainText("data-talqo-agent=")
	await expect(snippet).toContainText('data-talqo-language="en"')
	await expect(snippet).toContainText('data-talqo-position="bottom-right"')

	await page.getByLabel("Position").click()
	await page.getByRole("option", { name: "Bottom left" }).click()
	await expect(snippet).toContainText('data-talqo-position="bottom-left"')
	await expect(page.locator("iframe")).toHaveAttribute("src", /position=bottom-left/)
})

test("account security controls stay disabled until the account API exists", async ({ page }) => {
	await loginAsAdmin(page)
	await page.goto("/dashboard/account")
	await expect(page.getByRole("heading", { name: "Account" })).toBeVisible()
	await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(2)
	await expect(page.getByLabel("Current password")).toBeDisabled()
	await expect(page.getByLabel("New password", { exact: true })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled()
	await expect(page.getByRole("button", { name: "Delete account" })).toBeDisabled()
})
