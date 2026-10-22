import { expect, test } from "@playwright/test"

import { logIn } from "./log-in"

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
let website: SeededEmbed
let viewerId: string

test.beforeEach(async ({ page }) => {
	await logIn(page, operator)

	// The suite seeds once but these tests save, so a retry would start from mutated state.
	seeded = ((await (await page.request.get("/api/embeds")).json()) as { embeds: SeededEmbed[] }).embeds
	const source = seeded.find(({ name }) => name === "Website")
	if (!source) throw new Error("Shared seed Website embed is missing")
	website = source
	const { users } = (await (await page.request.get("/api/users")).json()) as {
		users: { id: string; username: string }[]
	}
	const viewer = users.find(({ username }) => username === "user")
	if (!viewer) throw new Error("Shared seed user is missing")
	viewerId = viewer.id

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
	const responsePromise = page.waitForResponse(
		(response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/embeds",
	)
	await page.getByRole("button", { name: "New embed" }).click()
	const response = await responsePromise
	expect(response.ok()).toBe(true)
	const { embed } = (await response.json()) as { embed: { id: string } }

	try {
		await expect(page).toHaveURL(`/dashboard/embeds/${embed.id}`)
		// The form arrives prefilled; the exact default copy lives in locales, not here.
		await expect(page.getByLabel("Name", { exact: true })).not.toHaveValue("")
	} finally {
		await page.request.delete(`/api/embeds/${embed.id}`)
	}
})

test("embed configuration waits for agent permissions before showing editable controls", async ({ page }) => {
	const embed = seeded[0]
	if (!embed) throw new Error("Shared seed embed is missing")
	const release = Promise.withResolvers<void>()
	await page.route("**/api/agents", async (route) => {
		await release.promise
		await route.continue()
	})
	try {
		const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/embeds/${embed.id}`)
		await page.goto(`/dashboard/embeds/${embed.id}`)
		await loaded
		await expect(page.locator("main").getByText("Loading…", { exact: true })).toBeVisible()
		await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0)
		release.resolve()
		await expect(page.getByLabel("Name", { exact: true })).toBeEnabled()
	} finally {
		release.resolve()
		await page.unroute("**/api/agents")
	}
})

test("operator permanently deletes an embed from its danger zone", async ({ page }) => {
	const source = website
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
		await page.getByRole("link", { name, exact: true }).click()
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
	await page.getByRole("link", { name: "Website", exact: true }).click()
	const previewCard = page.locator("[data-slot=card]", { hasText: "Live preview" })
	await expect(
		previewCard.locator("[data-slot=card-content]").getByRole("button", { name: "Open full-screen preview" }),
	).toBeVisible()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()

	// The frame must not navigate: appearance travels over postMessage, not the URL.
	const initialSrc = await page.locator("iframe").evaluate((iframe: HTMLIFrameElement) => iframe.src)

	// The Light tab is the default; its brand color field carries the seeded primary.
	await page.getByLabel("Brand color hex value", { exact: true }).fill("#b91c1c")
	await expect(launcher).toHaveCSS("background-color", "rgb(185, 28, 28)")
	await expect(page.locator("iframe")).toHaveJSProperty("src", initialSrc)

	await page.getByRole("button", { name: "Save changes" }).click()
	await expect(page.getByText("Saved just now.")).toBeVisible()

	await page.reload()
	await expect(preview.getByRole("button", { name: "Open chat" })).toHaveCSS("background-color", "rgb(185, 28, 28)")
})

test("operator switches to the Dark tab and edits an independent palette", async ({ page }) => {
	await page.getByRole("link", { name: "Website", exact: true }).click()

	const preview = page.frameLocator("iframe")
	const launcher = preview.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	const lightPrimary = await launcher.evaluate((el) => getComputedStyle(el).backgroundColor)

	await page.getByRole("tab", { name: "Dark" }).click()
	await page.getByLabel("Brand color hex value", { exact: true }).fill("#0ea5e9")
	await expect(launcher).toHaveCSS("background-color", "rgb(14, 165, 233)")

	// The light tab's own color must be unaffected by the dark edit.
	await page.getByRole("tab", { name: "Light" }).click()
	await expect(launcher).toHaveCSS("background-color", lightPrimary)
})

test("the widget's own name reaches the embedded chat header", async ({ page }) => {
	const source = website
	const name = `Header probe ${Date.now()}`
	const response = await page.request.post("/api/embeds", {
		data: { name, agentId: source.agentId, appearance: source.appearance },
	})
	expect(response.ok()).toBe(true)
	const probe = (await response.json()) as { embed: { id: string } }

	try {
		await page.goto(`/dashboard/embeds/${probe.embed.id}`)
		const preview = page.frameLocator("iframe")
		const launcher = preview.getByRole("button", { name: "Open chat" })
		await expect(launcher).toBeVisible()
		// A real pointer click is unreliable through the preview's CSS `transform: scale()`.
		await launcher.dispatchEvent("click")
		await expect(preview.getByRole("dialog").getByRole("heading")).toHaveText(name)
	} finally {
		await page.request.delete(`/api/embeds/${probe.embed.id}`)
	}
})

test("disabling an embed hides it publicly but keeps its appearance previews usable", async ({ page }) => {
	const source = website

	const card = page.locator("[data-slot=card]", { hasText: "Website" })
	const toggle = card.getByRole("switch", { name: "Embed enabled" })

	try {
		await expect(toggle).toBeChecked()
		await toggle.click()
		await expect(toggle).not.toBeChecked()

		// The ETag-cached public config is how already-installed embeds learn the state.
		await expect
			.poll(async () => {
				const response = await page.request.get(`/api/embed-config/${source.embedToken}`)
				return ((await response.json()) as { isAvailable: boolean }).isAvailable
			})
			.toBe(false)

		await page.goto(`/dashboard/embeds/${source.id}`)
		await expect(page.frameLocator("iframe").getByRole("button", { name: "Open chat" })).toBeVisible()
		await page.goto(`/embed-preview?embed=${source.id}`)
		await expect(page.frameLocator("iframe").getByRole("button", { name: "Open chat" })).toBeVisible()
		await page.goto(`/dashboard/agent/${source.agentId}?tab=embeds`)

		await toggle.click()
		await expect(toggle).toBeChecked()
		await expect
			.poll(async () => {
				const response = await page.request.get(`/api/embed-config/${source.embedToken}`)
				return ((await response.json()) as { isAvailable: boolean }).isAvailable
			})
			.toBe(true)
	} finally {
		// The shared seed keeps serving other journeys, so restore it on any failure path.
		await page.request.post(`/api/embeds/${source.id}/enable`)
	}
})

test("a read-only user can inspect embed state but cannot toggle it", async ({ page }) => {
	const viewer = { username: "user", password: "user1234" }

	// Give a read-only role through the API boundary, then switch accounts and inspect the same page.
	const roleResponse = await page.request.post("/api/roles", {
		data: { name: `Embed viewers ${Date.now()}`, permissions: [] },
	})
	await expect(roleResponse).toBeOK()
	const roleId = ((await roleResponse.json()) as { role: { id: string } }).role.id
	await Promise.all(
		[...new Set(seeded.map((embed) => embed.agentId))].map(async (agentId) =>
			expect(
				await page.request.put(`/api/agents/${agentId}/access/${roleId}`, { data: { permissions: ["agents:read"] } }),
			).toBeOK(),
		),
	)
	await expect(await page.request.put(`/api/users/${viewerId}/roles`, { data: { roleIds: [roleId] } })).toBeOK()

	try {
		await page.getByRole("button", { name: "Log out" }).click()
		await expect(page).toHaveURL("/login")
		await page.getByLabel("Username").fill(viewer.username)
		await page.getByLabel("Password", { exact: true }).fill(viewer.password)
		await page.getByRole("button", { name: "Log in" }).click()
		await expect(page).toHaveURL("/dashboard/agents")

		await page.getByRole("link", { name: "Agents", exact: true }).click()
		await page.getByRole("link", { name: /Website Assistant/ }).click()
		await page.getByRole("tab", { name: "Embeds" }).click()
		await expect(page.locator("[data-slot=card]", { hasText: "Website" })).toBeVisible()
		await expect(page.getByRole("switch", { name: "Embed enabled" })).toBeDisabled()
		await expect(page.getByRole("switch", { name: "Embed enabled" })).toBeChecked()
	} finally {
		await page.request.post("/api/auth/login", { data: operator })
		// Deleting the role also removes the assignment.
		await expect(await page.request.delete(`/api/roles/${roleId}`)).toBeOK()
	}
})

test("operator rotates an embed token and receives a replacement snippet", async ({ page }) => {
	const source = website
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
		await expect(dialog).toBeHidden()

		await expect(tokenInput).not.toHaveValue(original)
		await expect(page.locator("pre")).not.toContainText(original)

		// The replacement snippet carries the live token and stays non-blocking.
		const rotated = await tokenInput.inputValue()
		const snippet = page.locator("pre")
		await expect(snippet).toContainText(`data-talqo-embed-token="${rotated}"`)
		await expect(snippet).toContainText("<script async")
	} finally {
		await page.request.delete(`/api/embeds/${temporary.embed.id}`)
	}
})
