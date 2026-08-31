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
	// Widget customization lives on the owning agent's page.
	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await page.getByRole("link", { name: /Website Assistant/ }).click()
	await page.getByRole("tab", { name: "Widgets" }).click()
})

test("operator customizes a widget and the preview follows without reloading", async ({ page }) => {
	const card = page.locator("[data-slot=card]", { hasText: "Marketing site" })
	await expect(card).toBeVisible()
	await card.click()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	await expect(launcher).toHaveCSS("background-color", "rgb(124, 58, 237)")

	// The frame must not navigate: appearance travels over postMessage, not the URL.
	const initialSrc = await page.locator("iframe").getAttribute("src")

	// The Light tab is the default; its brand color field carries the seeded primary.
	await page.getByLabel("Brand color hex value", { exact: true }).fill("#b91c1c")
	await expect(launcher).toHaveCSS("background-color", "rgb(185, 28, 28)")
	expect(await page.locator("iframe").getAttribute("src")).toBe(initialSrc)

	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	await page.reload()
	await expect(preview.getByRole("button", { name: "Open chat" })).toHaveCSS("background-color", "rgb(185, 28, 28)")
})

test("changing the light text color leaves the light background untouched", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Marketing site" }).click()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	// A real pointer click is unreliable through the preview's CSS `transform: scale()`.
	await launcher.dispatchEvent("click")
	const panel = preview.getByRole("dialog")
	await expect(panel).toBeVisible()

	await page.getByLabel("Text hex value", { exact: true }).fill("#ff00ff")

	// The panel paints the surface color (#f5f5f5), unaffected by the text edit.
	await expect(panel).toHaveCSS("background-color", "rgb(245, 245, 245)")
})

test("operator switches to the Dark tab and edits an independent palette", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Marketing site" }).click()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	const lightPrimary = await launcher.evaluate((el) => getComputedStyle(el).backgroundColor)

	await page.getByRole("tab", { name: "Dark" }).click()
	// The dark scheme's own default brand color, unaffected by whatever light currently holds.
	await expect(launcher).toHaveCSS("background-color", "rgb(52, 211, 153)")

	await page.getByLabel("Brand color hex value", { exact: true }).fill("#0ea5e9")
	await expect(launcher).toHaveCSS("background-color", "rgb(14, 165, 233)")

	// The light tab's own color must be unaffected by the dark edit.
	await page.getByRole("tab", { name: "Light" }).click()
	await expect(launcher).toHaveCSS("background-color", lightPrimary)
})

test("operator moves the widget to the other corner", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Marketing site" }).click()

	const positionSelect = page.getByLabel("Position")
	await expect(positionSelect).toContainText("Bottom right")
	await positionSelect.click()
	await page.getByRole("option", { name: "Bottom left" }).click()

	await expect(page.frameLocator("iframe").locator(".talqo-widget")).toHaveClass(/left-4/)
})

test("operator reassigns the widget to a different agent", async ({ page }) => {
	// The seed has one agent; reassignment needs a second target.
	await page.request.post("/api/agents", {
		data: { name: "Sales assistant", systemPrompt: "You answer sales questions.", wordBlacklist: [] },
	})

	await page.locator("[data-slot=card]", { hasText: "Support portal" }).click()

	// Base UI shows the raw id in a closed trigger unless `items` maps it to a name.
	const agentSelect = page.getByLabel("Agent")
	await expect(agentSelect).toContainText("Website Assistant")
	await agentSelect.click()
	await page.getByRole("option", { name: "Sales assistant" }).click()
	await expect(agentSelect).toContainText("Sales assistant")
	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	await page.getByRole("button", { name: "Back to agent" }).click()
	await expect(page.getByRole("heading", { name: "Configure Sales assistant" })).toBeVisible()
	await page.getByRole("tab", { name: "Widgets" }).click()
	await expect(page.locator("[data-slot=card]", { hasText: "Support portal" })).toBeVisible()
})

test("the widget's own name reaches the embedded chat header", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Marketing site" }).click()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	// A real pointer click is unreliable through the preview's CSS `transform: scale()`.
	await launcher.dispatchEvent("click")
	await expect(preview.getByRole("dialog").getByRole("heading")).toHaveText("Marketing site")
})

test("embed snippet carries the public token and no baked-in appearance", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Marketing site" }).click()

	const snippet = page.locator("pre")
	const widgetToken = process.env.E2E_WIDGET_TOKEN
	if (!widgetToken) throw new Error("E2E_WIDGET_TOKEN missing — scripts/test-e2e.ts provides it from the API seed")

	await expect(snippet).toContainText(`data-talqo-widget="${widgetToken}"`)
	// Appearance must never be inlined, or a copied snippet would freeze the palette.
	await expect(snippet).not.toContainText("data-talqo-accent")
	await expect(snippet).not.toContainText("data-talqo-light-primary")
	await expect(snippet).not.toContainText("data-talqo-position")
})
