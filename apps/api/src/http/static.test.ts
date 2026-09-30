import { describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createStaticResponder, resolveStaticDirs } from "./static.ts"

const ORIGIN = "http://app.example.com"

function fixtureDirs() {
	const root = mkdtempSync(join(tmpdir(), "talqo-static-"))
	const webDist = join(root, "web")
	const widgetDist = join(root, "widget")
	mkdirSync(join(webDist, "assets"), { recursive: true })
	mkdirSync(widgetDist, { recursive: true })
	writeFileSync(join(root, "secret.txt"), "secret")
	writeFileSync(join(webDist, "index.html"), "<html>app</html>")
	writeFileSync(join(webDist, "assets", "app-abc123.js"), "console.log(1)")
	writeFileSync(join(widgetDist, "widget.js"), "console.log(2)")
	writeFileSync(join(widgetDist, "widget.css"), ".x{}")
	writeFileSync(join(widgetDist, "preview.html"), "<html>preview</html>")
	return { webDist, widgetDist }
}

function request(path: string, method = "GET"): Request {
	return new Request(`${ORIGIN}${path}`, { method })
}

describe("resolveStaticDirs", () => {
	it("stays off unless explicitly enabled", () => {
		expect(resolveStaticDirs({})).toEqual({})
		expect(resolveStaticDirs({ TALQO_SERVE_STATIC: "false" })).toEqual({})
	})

	it("maps explicit dirs when enabled", () => {
		expect(resolveStaticDirs({ TALQO_SERVE_STATIC: "true", TALQO_WEB_DIST: "/a", TALQO_WIDGET_DIST: "/b" })).toEqual({
			webDist: "/a",
			widgetDist: "/b",
		})
		expect(resolveStaticDirs({ TALQO_SERVE_STATIC: "true" })).toEqual({})
	})
})

describe("createStaticResponder", () => {
	it("serves the widget bundle and caches only versioned URLs immutably", async () => {
		const serve = createStaticResponder(fixtureDirs())

		const unversioned = await serve(request("/widget.js"))
		expect(unversioned?.status).toBe(200)
		expect(unversioned?.headers.get("Content-Type")).toContain("javascript")
		expect(unversioned?.headers.get("Cache-Control")).toBeNull()
		expect(await unversioned?.text()).toContain("console.log(2)")

		const versioned = await serve(request("/widget.js?v=42"))
		expect(versioned?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")

		const css = await serve(request("/widget.css?v=42"))
		expect(css?.status).toBe(200)
		expect(css?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")

		const preview = await serve(request("/preview.html"))
		expect(preview?.status).toBe(200)
		expect(preview?.headers.get("Content-Type")).toContain("text/html")
		expect(preview?.headers.get("Cache-Control")).toBe("no-cache")
	})

	it("serves hashed web assets but never escapes the assets dir", async () => {
		const serve = createStaticResponder(fixtureDirs())

		const asset = await serve(request("/assets/app-abc123.js"))
		expect(asset?.status).toBe(200)
		expect(asset?.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable")

		expect(await serve(request("/assets/missing.js"))).toBeNull()
		// Dot segments normalize before serving, so an escape attempt can at
		// worst reach the public dashboard, never the file outside the dist.
		const escape = await serve(request("/assets/../secret.txt"))
		expect(await escape?.text()).not.toContain("secret")
	})

	it("falls back to the dashboard for app routes and leaves the rest alone", async () => {
		const serve = createStaticResponder(fixtureDirs())

		const fallback = await serve(request("/dashboard/embeds/123"))
		expect(fallback?.status).toBe(200)
		expect(fallback?.headers.get("Content-Type")).toContain("text/html")
		expect(fallback?.headers.get("Cache-Control")).toBe("no-cache")
		expect(await fallback?.text()).toContain("<html>app</html>")

		expect(await serve(request("/api/missing"))).toBeNull()
		expect(await serve(request("/health"))).toBeNull()
		expect(await serve(request("/widget.js", "POST"))).toBeNull()
	})

	it("answers nothing for missing widget files", async () => {
		const { webDist } = fixtureDirs()
		const serve = createStaticResponder({ webDist })

		expect(await serve(request("/widget.js"))).toBeNull()
	})

	it("answers nothing when the dists hold no built files", async () => {
		const root = mkdtempSync(join(tmpdir(), "talqo-static-empty-"))
		const serve = createStaticResponder({ webDist: join(root, "web"), widgetDist: join(root, "widget") })

		expect(await serve(request("/widget.js"))).toBeNull()
		expect(await serve(request("/dashboard"))).toBeNull()
	})
})
