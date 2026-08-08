import { expect, test } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import path from "node:path"

// Boots the real built widget.js + widget.css on a bare host page, like a
// customer site would (a missing process define or a global-CSS regression
// once crashed the boot silently).
const DIST = path.resolve(__dirname, "../../widget/dist")
const HOST_HTML_PATH = path.resolve(__dirname, "fixtures/host.html")

let server: Server
let baseURL: string

test.beforeAll(async () => {
	const hostHtml = await readFile(HOST_HTML_PATH, "utf8")
	server = createServer((req, res) => {
		if (req.url === "/") {
			res.writeHead(200, { "content-type": "text/html" }).end(hostHtml)
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

	await page.goto(baseURL)
	await expect(page.locator("#talqo-widget")).toBeAttached()

	const launcher = page.getByRole("button", { name: "Open chat" })
	await expect(launcher).toBeVisible()

	await launcher.click()
	const dialog = page.getByRole("dialog")
	await expect(dialog).toBeVisible()

	// Stripped preflight is replaced by the scoped reset: no UA chrome on icon
	// buttons, and utilities still override it (input keeps its 1px border).
	const closeButton = dialog.getByRole("button", { name: "Close chat" })
	await expect(closeButton).toHaveCSS("border-top-width", "0px")
	await expect(closeButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)")
	const input = dialog.getByRole("textbox")
	await expect(input).toHaveCSS("border-top-width", "1px")
	await expect(input).toHaveCSS("border-top-style", "solid")

	// Close via the in-dialog button; the launcher flips back to "Open chat".
	await closeButton.click()
	await expect(dialog).toBeHidden()

	// Launcher acts as a toggle again.
	await launcher.click()
	await expect(dialog).toBeVisible()

	expect(errors).toEqual([])
})
