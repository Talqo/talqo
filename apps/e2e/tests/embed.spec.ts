import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import path from "node:path"

const DIST = path.resolve(__dirname, "../../widget/dist")
const HOST_HTML_PATH = path.resolve(__dirname, "fixtures/host.html")

// The seeded widget's brand color, as rgb() for toHaveCSS.
const SEEDED_PRIMARY_RGB = "rgb(124, 58, 237)"
const DEFAULT_PRIMARY_RGB = "rgb(26, 127, 75)"

let server: Server
let baseURL: string

test.beforeAll(async () => {
	const token = process.env.E2E_WIDGET_TOKEN
	const apiPort = process.env.TALQO_API_PORT
	if (!token) throw new Error("E2E_WIDGET_TOKEN missing — scripts/test-e2e.ts provides it from the API seed")
	if (!apiPort) throw new Error("TALQO_API_PORT missing — scripts/test-e2e.ts provides it")

	// Deliberately a different origin from the host page below, so the widget's config
	// request is genuinely cross-origin and exercises the API's CORS policy for real.
	const apiOrigin = `http://127.0.0.1:${apiPort}`
	const template = await readFile(HOST_HTML_PATH, "utf8")
	const configured = template.replace("__TOKEN__", token).replace("__API_ORIGIN__", apiOrigin)
	const unknownToken = template.replace("__TOKEN__", "not-a-real-token").replace("__API_ORIGIN__", apiOrigin)

	server = createServer((req, res) => {
		if (req.url === "/") {
			res.writeHead(200, { "content-type": "text/html" }).end(configured)
			return
		}
		if (req.url === "/unknown-token") {
			res.writeHead(200, { "content-type": "text/html" }).end(unknownToken)
			return
		}
		const file = req.url === "/widget.js" || req.url === "/widget.css" ? path.join(DIST, req.url.slice(1)) : null
		if (!file) {
			res.writeHead(404).end()
			return
		}
		readFile(file)
			.then((content) => {
				res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "text/css" }).end(content)
			})
			.catch(() => res.writeHead(404).end())
	})
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve)
	})
	const address = server.address()
	if (typeof address !== "object" || !address) {
		throw new Error("embed stub server failed to bind")
	}
	baseURL = `http://127.0.0.1:${address.port}`
})

test.afterAll(() => {
	server.close()
})

test("built widget boots, mounts, and stays styled on a bare host page", async ({ page }) => {
	const errors: string[] = []
	page.on("pageerror", (error) => errors.push(String(error)))
	// A blocked CORS request surfaces here and never throws, so without this a CORS
	// regression would slip past the pageerror assertion below.
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text())
	})

	await page.goto(baseURL)
	await expect(page.locator("#talqo-widget")).toBeAttached()

	const launcher = page.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()

	await launcher.click()
	const dialog = page.getByRole("dialog")
	await expect(dialog).toBeVisible()

	const closeButton = dialog.getByRole("button", { name: "Close chat" })
	await expect(closeButton).toHaveCSS("border-top-width", "0px")
	await expect(closeButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
	const input = dialog.getByRole("textbox")
	await expect(input).toHaveCSS("border-top-width", "1px")
	await expect(input).toHaveCSS("border-top-style", "solid")

	await closeButton.click()
	await expect(dialog).toBeHidden()

	await launcher.click()
	await expect(dialog).toBeVisible()

	expect(errors).toEqual([])
})

test("widget fetches its palette by public token across origins", async ({ page }) => {
	await page.goto(baseURL)

	// Proves the whole chain in one assertion: token lookup, CORS, and the fetched
	// color reaching the CSS custom property the launcher paints from.
	await expect(page.getByRole("button", { name: "Open chat" })).toHaveCSS("background-color", SEEDED_PRIMARY_RGB)
})

test("widget derives its surfaces from the fetched palette", async ({ page }) => {
	await page.goto(baseURL)
	await page.getByRole("button", { name: "Open chat" }).click()

	// color-mix() at work: the panel is a near-background surface, not the raw
	// foreground the no-color-mix fallback would produce.
	await expect(page.getByRole("dialog")).toHaveCSS("background-color", /rgb\(2[45]\d, 2[45]\d, 2[45]\d\)/)
})

test("widget still renders in default colors when its token is unknown", async ({ page }) => {
	await page.goto(`${baseURL}/unknown-token`)

	const launcher = page.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()
	await expect(launcher).toHaveCSS("background-color", DEFAULT_PRIMARY_RGB)
})
