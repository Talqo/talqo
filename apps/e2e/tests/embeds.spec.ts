import { expect, test } from "@playwright/test"

const operator = { username: "admin", password: "admin123" }

type SeededEmbed = {
	id: string
	name: string
	agentId: string
	appearance: unknown
	accessVersion: number
	embedToken: string
}

let seeded: SeededEmbed[] = []

test.beforeEach(async ({ page }) => {
	await page.goto("/login")
	await page.getByLabel("Username").fill(operator.username)
	await page.getByLabel("Password", { exact: true }).fill(operator.password)
	await page.getByRole("button", { name: "Log in" }).click()
	await expect(page).toHaveURL("/dashboard")

	// The suite seeds once but these tests save, so a retry would start from mutated state.
	seeded = ((await (await page.request.get("/api/embeds")).json()) as { embeds: SeededEmbed[] }).embeds

	// Widget customization lives on the owning agent's page.
	await page.getByRole("link", { name: "Agents", exact: true }).click()
	await page.getByRole("link", { name: /Website Assistant/ }).click()
	await page.getByRole("tab", { name: "Embeds" }).click()
})

// Runs even when the test fails, which is exactly when the state is left dirty.
test.afterEach(async ({ page }) => {
	await Promise.all(
		seeded.map((embed) =>
			page.request.put(`/api/embeds/${embed.id}`, {
				data: { name: embed.name, agentId: embed.agentId, appearance: embed.appearance },
			}),
		),
	)
})

test("operator creates an embed and configures it immediately", async ({ page }) => {
	const createdIds: string[] = []
	const createEmbed = async () => {
		const responsePromise = page.waitForResponse(
			(response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/embeds",
		)
		await page.getByRole("button", { name: "New embed" }).click()
		const response = await responsePromise
		expect(response.ok()).toBe(true)
		const { embed } = (await response.json()) as { embed: { id: string } }
		createdIds.push(embed.id)
		await expect(page).toHaveURL(`/dashboard/embeds/${embed.id}`)
	}

	try {
		await createEmbed()
		await expect(page.getByLabel("Name", { exact: true })).toHaveValue("AI Assistant")

		await page.getByRole("button", { name: "Back to agent" }).click()
		await createEmbed()
		await expect(page.getByLabel("Name", { exact: true })).toHaveValue("AI Assistant")
	} finally {
		await Promise.all(createdIds.map((embedId) => page.request.delete(`/api/embeds/${embedId}`)))
	}
})

test("operator permanently deletes an embed from its danger zone", async ({ page }) => {
	const source = seeded[0]
	if (!source) throw new Error("Shared seed embed is missing")
	const name = "Disposable embed"
	const response = await page.request.post("/api/embeds", {
		data: { name, agentId: source.agentId, appearance: source.appearance },
	})
	expect(response.ok()).toBe(true)
	const { embed } = (await response.json()) as { embed: { id: string } }

	try {
		await page.reload()
		const embedCard = page.locator("[data-slot=card]", { hasText: name })
		await expect(embedCard).toBeVisible()
		await embedCard.click()
		await expect(page).toHaveURL(`/dashboard/embeds/${embed.id}`)
		const deleteButton = page.getByRole("button", { name: "Delete embed" })
		await expect(deleteButton).toBeVisible()
		await deleteButton.click()
		const dialog = page.getByRole("dialog", { name: "Delete embed?" })
		const confirmButton = dialog.getByRole("button", { name: "Delete permanently" })
		await expect(confirmButton).toBeDisabled()
		await dialog.getByPlaceholder(name).fill(`${name} typo`)
		await expect(confirmButton).toBeDisabled()
		await dialog.getByPlaceholder(name).fill(name)
		await expect(confirmButton).toBeEnabled()
		await confirmButton.click()

		await expect(page).toHaveURL(`/dashboard/agent/${source.agentId}?tab=embeds`)
		await expect(page.locator("[data-slot=card]", { hasText: name })).toHaveCount(0)
		await expect.poll(async () => (await page.request.get(`/api/embeds/${embed.id}`)).status()).toBe(404)
	} finally {
		await page.request.delete(`/api/embeds/${embed.id}`)
	}
})

test("operator customizes an embed and the widget preview follows without reloading", async ({ page }) => {
	const card = page.locator("[data-slot=card]", { hasText: "Website" })
	await expect(card).toBeVisible()
	await card.click()
	const previewCard = page.locator("[data-slot=card]", { hasText: "Live preview" })
	await expect(
		previewCard.locator("[data-slot=card-content]").getByRole("button", { name: "Open full-screen preview" }),
	).toBeVisible()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	await expect(launcher).toHaveCSS("background-color", "rgb(26, 127, 75)")

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
	await page.locator("[data-slot=card]", { hasText: "Website" }).click()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	// A real pointer click is unreliable through the preview's CSS `transform: scale()`.
	await launcher.dispatchEvent("click")
	const panel = preview.getByRole("dialog")
	await expect(panel).toBeVisible()

	await page.getByLabel("Text hex value", { exact: true }).fill("#ff00ff")

	// The panel paints the background color (#ffffff), unaffected by the text edit.
	await expect(panel).toHaveCSS("background-color", "rgb(255, 255, 255)")
})

test("operator switches to the Dark tab and edits an independent palette", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Website" }).click()

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

test("operator moves the embedded widget to the other corner", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Website" }).click()

	const positionSelect = page.getByLabel("Position")
	await expect(positionSelect).toContainText("Bottom right")
	await positionSelect.click()
	await page.getByRole("option", { name: "Bottom left" }).click()

	await expect(page.frameLocator("iframe").locator(".talqo-widget")).toHaveClass(/left-4/)
})

test("operator reassigns the embed to a different agent", async ({ page }) => {
	const source = seeded[0]
	if (!source) throw new Error("Shared seed embed is missing")
	const agentResponse = await page.request.post("/api/agents", {
		data: { name: "Sales assistant", systemPrompt: "You answer sales questions.", wordBlacklist: [] },
	})
	await expect(agentResponse).toBeOK()
	const { agent } = (await agentResponse.json()) as { agent: { id: string } }
	const embedResponse = await page.request.post("/api/embeds", {
		data: { name: "Reassignment test", agentId: source.agentId, appearance: source.appearance },
	})
	await expect(embedResponse).toBeOK()
	const { embed } = (await embedResponse.json()) as { embed: { id: string } }

	try {
		await page.goto(`/dashboard/embeds/${embed.id}`)
		const agentSelect = page.getByLabel("Agent")
		await expect(agentSelect).toContainText("Website Assistant")
		await agentSelect.click()
		await page.getByRole("option", { name: "Sales assistant" }).click()
		await expect(agentSelect).toContainText("Sales assistant")
		await page.getByRole("button", { name: "Save changes" }).click()
		await expect(page.getByText("Saved just now.")).toBeVisible()

		await page.getByRole("button", { name: "Back to agent" }).click()
		await expect(page.getByRole("heading", { name: "Configure Sales assistant" })).toBeVisible()
		await page.getByRole("tab", { name: "Embeds" }).click()
		await expect(page.locator("[data-slot=card]", { hasText: "Reassignment test" })).toBeVisible()
	} finally {
		await page.request.delete(`/api/embeds/${embed.id}`)
		await page.request.delete(`/api/agents/${agent.id}`)
	}
})

test("the widget's own name reaches the embedded chat header", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Website" }).click()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	// A real pointer click is unreliable through the preview's CSS `transform: scale()`.
	await launcher.dispatchEvent("click")
	await expect(preview.getByRole("dialog").getByRole("heading")).toHaveText("Website")
})

test("embed snippet carries the public token and no baked-in appearance", async ({ page }) => {
	await page.locator("[data-slot=card]", { hasText: "Website" }).click()

	const snippet = page.locator("pre")
	await expect(snippet).toContainText('data-talqo-embed-token="F2qM7vR9xL4nK8pT6sW3yB5cD1hJ0uA9eG7iN2oQ4zX"')
	// Appearance must never be inlined, or a copied snippet would freeze the palette.
	await expect(snippet).not.toContainText("data-talqo-accent")
	await expect(snippet).not.toContainText("data-talqo-light-primary")
	await expect(snippet).not.toContainText("data-talqo-position")
})

test("operator rotates an embed token and receives a replacement snippet", async ({ page }) => {
	const source = seeded.find(({ name }) => name === "Website")
	if (!source) throw new Error("Shared seed Website embed is missing")
	const response = await page.request.post("/api/embeds", {
		data: { name: "Rotation test", agentId: source.agentId, appearance: source.appearance },
	})
	const temporary = (await response.json()) as { embed: SeededEmbed }

	try {
		await page.goto(`/dashboard/embeds/${temporary.embed.id}`)
		const tokenInput = page.getByLabel("Embed token", { exact: true })
		const original = await tokenInput.inputValue()

		await page.getByRole("button", { name: "Rotate token" }).click()
		const dialog = page.getByRole("dialog", { name: "Rotate the embed token?" })
		await dialog.getByRole("button", { name: "Rotate token" }).click()
		await expect(dialog).not.toBeVisible()

		await expect(tokenInput).not.toHaveValue(original)
		await expect(page.locator("pre")).not.toContainText(original)
	} finally {
		await page.request.delete(`/api/embeds/${temporary.embed.id}`)
	}
})
