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

test("operator customizes a widget and the preview follows without reloading", async ({ page }) => {
	await page.getByRole("link", { name: "Widgets", exact: true }).click()
	await expect(page).toHaveURL("/dashboard/widgets")

	const card = page.locator("[data-slot=card]", { hasText: "Marketing site" })
	await expect(card).toBeVisible()
	await expect(card.getByText("Served by Website Assistant")).toBeVisible()
	await card.click()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	await expect(launcher).toHaveCSS("background-color", "rgb(124, 58, 237)")

	// The frame must not navigate: appearance travels over postMessage, not the URL.
	const initialSrc = await page.locator("iframe").getAttribute("src")

	// Exact: "Text on brand color hex value" also contains this label as a substring.
	await page.getByLabel("Brand color hex value", { exact: true }).fill("#b91c1c")
	await expect(launcher).toHaveCSS("background-color", "rgb(185, 28, 28)")
	expect(await page.locator("iframe").getAttribute("src")).toBe(initialSrc)

	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	await page.reload()
	await expect(preview.getByRole("button", { name: "Open chat" })).toHaveCSS("background-color", "rgb(185, 28, 28)")
})

test("operator moves the widget to the other corner", async ({ page }) => {
	await page.goto("/dashboard/widgets")
	await page.locator("[data-slot=card]", { hasText: "Marketing site" }).click()

	const positionSelect = page.getByLabel("Position")
	await expect(positionSelect).toContainText("Bottom right")
	await positionSelect.click()
	await page.getByRole("option", { name: "Bottom left" }).click()

	await expect(page.frameLocator("iframe").locator(".talqo-widget")).toHaveClass(/left-4/)
})

test("operator reassigns the widget to a different agent", async ({ page }) => {
	// The API seed provides a single agent; reassignment needs a second target.
	await page.request.post("/api/agents", {
		data: { name: "Sales assistant", systemPrompt: "You answer sales questions.", wordBlacklist: [] },
	})

	await page.goto("/dashboard/widgets")
	await page.locator("[data-slot=card]", { hasText: "Support portal" }).click()

	// The closed trigger has to read the agent's name; Base UI would otherwise show its id.
	const agentSelect = page.getByLabel("Agent")
	await expect(agentSelect).toContainText("Website Assistant")
	await agentSelect.click()
	await page.getByRole("option", { name: "Sales assistant" }).click()
	await expect(agentSelect).toContainText("Sales assistant")
	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	await page.getByRole("button", { name: "Back to widgets" }).click()
	const card = page.locator("[data-slot=card]", { hasText: "Support portal" })
	await expect(card.getByText("Served by Sales assistant")).toBeVisible()
})

test("embed snippet carries the public token and no baked-in appearance", async ({ page }) => {
	await page.goto("/dashboard/widgets")
	await page.locator("[data-slot=card]", { hasText: "Marketing site" }).click()

	const snippet = page.locator("pre")
	const widgetToken = process.env.E2E_WIDGET_TOKEN
	if (!widgetToken) throw new Error("E2E_WIDGET_TOKEN missing — scripts/test-e2e.ts provides it from the API seed")

	await expect(snippet).toContainText(`data-talqo-widget="${widgetToken}"`)
	// Appearance must never be inlined, or a copied snippet would freeze the palette.
	await expect(snippet).not.toContainText("data-talqo-accent")
	await expect(snippet).not.toContainText("data-talqo-primary")
	await expect(snippet).not.toContainText("data-talqo-position")
})
