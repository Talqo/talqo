import { expect } from "@playwright/test"

import { test } from "./chat-embed"
import { widget } from "./i18n"

test("built widget boots in a sandboxed CDN-only preview frame", async ({ page, application }) => {
	const baseURL = application.widgetHostOrigin
	await page.goto(`${baseURL}/missing`)
	await page.setContent('<iframe title="CDN-only preview"></iframe>')
	const srcDoc = `<!doctype html><html><body><div id="talqo-widget"></div><script src="${baseURL}/widget.js" data-talqo-preview data-talqo-parent-origin="${baseURL}"></script></body></html>`

	await page.locator("iframe").evaluate(
		(frame, config) => {
			const iframe = frame as HTMLIFrameElement
			window.addEventListener("message", (event) => {
				const data = event.data as { type?: unknown }
				if (event.source !== iframe.contentWindow || data?.type !== "ready") return
				iframe.contentWindow?.postMessage(config.message, "*")
			})
			iframe.setAttribute("sandbox", "allow-scripts")
			iframe.srcdoc = config.srcDoc
		},
		{
			srcDoc,
			message: {
				source: "talqo-preview",
				version: 1,
				type: "config",
				isAvailable: true,
				appearance: {
					light: {
						primary: "#1a7f4b",
						textOnPrimary: "#ffffff",
						background: "#ffffff",
						surface: "#f5f5f5",
						text: "#171717",
					},
					position: "bottom-right",
					theme: "light",
				},
			},
		},
	)

	const preview = page.frameLocator("iframe")
	await preview.getByRole("button", { name: widget("openChat") }).click()
	await expect(preview.getByRole("dialog")).toBeVisible()
})

test("widget fetches and paints its palette across origins", async ({ page, chatEmbed }) => {
	const errors: string[] = []
	page.on("pageerror", (error) => errors.push(String(error)))
	// A blocked CORS request only logs, so pageerror alone would miss a CORS regression.
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text())
	})

	await page.goto(chatEmbed.widgetUrl)

	await expect(page.getByRole("button", { name: widget("openChat") })).toHaveCSS(
		"background-color",
		"rgb(124, 58, 237)",
	)
	await page.getByRole("button", { name: widget("openChat") }).click()

	await expect(page.getByRole("dialog")).toHaveCSS("background-color", "rgb(255, 247, 237)")
	await expect(page.getByRole("dialog").getByRole("textbox")).toHaveCSS("background-color", "rgb(255, 237, 213)")
	expect(errors).toEqual([])
})

test("widget streams a multi-turn chat and verifies history", async ({ page, request, chatEmbed }) => {
	const { providerControlOrigin } = chatEmbed

	await page.goto(chatEmbed.widgetUrl)
	await page.getByRole("button", { name: widget("openChat") }).click()
	const dialog = page.getByRole("dialog")
	const messageInput = dialog.getByRole("textbox", { name: widget("messageLabel") })
	const send = async (text: string) => {
		await messageInput.fill(text)
		await dialog.getByRole("button", { name: widget("send") }).click()
	}

	await send("Give me the first answer")
	await expect(dialog.getByText("First", { exact: true })).toBeVisible()
	await expect(await request.post(`${providerControlOrigin}/release`)).toBeOK()
	await expect(dialog.getByText("First streamed answer.", { exact: true })).toBeVisible()

	await send("Prove you received the earlier turn")
	await expect(dialog.getByText("Second streamed answer.", { exact: true })).toBeVisible()
	const captured = (await (await request.get(`${providerControlOrigin}/requests`)).json()) as {
		requests: { messages: { content: unknown; role: string }[] }[]
	}
	expect(captured.requests[1]?.messages).toEqual([
		{ role: "system", content: expect.stringContaining("support assistant") },
		{ role: "user", content: "Give me the first answer" },
		{ role: "assistant", content: "First streamed answer." },
		{ role: "user", content: "Prove you received the earlier turn" },
	])

	// The same session proves persistence: a reload must not lose either turn.
	await page.reload()
	await page.getByRole("button", { name: widget("openChat") }).click()
	await expect(dialog.getByText("Give me the first answer", { exact: true })).toBeVisible()
	await expect(dialog.getByText("First streamed answer.", { exact: true })).toBeVisible()
	await expect(dialog.getByText("Prove you received the earlier turn", { exact: true })).toBeVisible()
	await expect(dialog.getByText("Second streamed answer.", { exact: true })).toBeVisible()
})

test("widget cancels a stream and starts a new chat preserving history", async ({
	page,
	request,
	application,
	chatEmbed,
}) => {
	const { providerControlOrigin } = chatEmbed

	await page.goto(chatEmbed.widgetUrl)
	await page.getByRole("button", { name: widget("openChat") }).click()
	const dialog = page.getByRole("dialog")
	const messageInput = dialog.getByRole("textbox", { name: widget("messageLabel") })
	const send = async (text: string) => {
		await messageInput.fill(text)
		await dialog.getByRole("button", { name: widget("send") }).click()
	}

	await send("Give me the first answer")
	await expect(dialog.getByText("First", { exact: true })).toBeVisible()
	await expect(await request.post(`${providerControlOrigin}/release`)).toBeOK()
	await expect(dialog.getByText("First streamed answer.", { exact: true })).toBeVisible()

	await send("Stream until I cancel")
	// The API's blacklist look-behind withholds the provider chunk tail until cancellation confirms it is safe.
	await expect(dialog.getByText("Cancellation partial output remains", { exact: true })).toBeVisible()
	await dialog.getByRole("button", { name: widget("stopGenerating") }).click()
	await expect(dialog.getByText(widget("outcomeCancelled"), { exact: true })).toBeVisible()
	await expect(dialog.getByRole("button", { name: widget("stopGenerating") })).toHaveCount(0)

	const oldCredential = await page.evaluate(() => {
		const entry: [string, string] | undefined = Object.entries(localStorage).find(([key]) =>
			key.startsWith("talqo:chat:v1:"),
		)
		const stored: unknown = entry?.[1] ? JSON.parse(entry[1]) : undefined
		if (!stored || typeof stored !== "object" || !("credential" in stored) || typeof stored.credential !== "string") {
			throw new Error("Expected the widget to persist its session credential")
		}
		return stored.credential
	})

	await dialog.getByRole("button", { name: widget("newChat") }).click()
	await expect(dialog.getByText("Give me the first answer", { exact: true })).toHaveCount(0)

	const response = await request.get(`${application.origin}/api/chat/session`, {
		headers: { Authorization: `Bearer ${oldCredential}` },
	})
	await expect(response).toBeOK()
	const oldSession = (await response.json()) as { messages: { outcome: string; role: string; text: string }[] }
	expect(oldSession.messages).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ role: "assistant", text: "First streamed answer.", outcome: "completed" }),
			expect.objectContaining({
				role: "assistant",
				text: "Cancellation partial output remains visible",
				outcome: "cancelled",
			}),
		]),
	)
})

test("widget enforces daily chat allowance across new chats", async ({ page, request, chatEmbed }) => {
	const { providerControlOrigin } = chatEmbed

	await page.goto(chatEmbed.widgetUrl)
	await page.getByRole("button", { name: widget("openChat") }).click()
	const dialog = page.getByRole("dialog")
	const messageInput = dialog.getByRole("textbox", { name: widget("messageLabel") })
	const sendUntilAnswered = async () => {
		await messageInput.fill("Give me the first answer")
		await dialog.getByRole("button", { name: widget("send") }).click()
		await expect(dialog.getByText("First", { exact: true })).toBeVisible()
		await expect(await request.post(`${providerControlOrigin}/release`)).toBeOK()
		await expect(dialog.getByRole("button", { name: widget("stopGenerating") })).toHaveCount(0)
	}

	// The allowance is per agent and visitor network, not per session.
	await sendUntilAnswered()
	await sendUntilAnswered()
	await sendUntilAnswered()
	await expect(dialog.getByText("First streamed answer.", { exact: true })).toHaveCount(3)

	// Starting over does not top the allowance back up.
	await dialog.getByRole("button", { name: widget("newChat") }).click()
	await expect(dialog.getByText("Give me the first answer", { exact: true })).toHaveCount(0)

	await messageInput.fill("The allowance must not reset")
	await dialog.getByRole("button", { name: widget("send") }).click()
	const [allowance] = widget("errorDailyAllowance").split("{{reset}}")
	await expect(dialog.getByRole("alert")).toContainText((allowance ?? "").trim())
})
