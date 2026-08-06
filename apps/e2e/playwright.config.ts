import { defineConfig, devices } from "@playwright/test"
import { spawnSync } from "node:child_process"

const isCI = Boolean(process.env.CI)

// Config is loaded once by the test runner and again in each worker; the
// worker inherits the runner's env, so resolving the port only when the URL
// is unset keeps every process on the same value.
function widgetOrigin(): string {
	const configured = process.env.E2E_WIDGET_CDN_URL
	if (configured) {
		return new URL(configured).origin
	}
	const script =
		'require("node:net").createServer().once("error",()=>process.exit(1)).listen(0,"127.0.0.1",function(){process.stdout.write(String(this.address().port)),this.close()})'
	const probe = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" })
	if (probe.status !== 0 || !probe.stdout.trim()) {
		throw new Error("e2e: failed to reserve a free port for the widget dev server")
	}
	return `http://localhost:${probe.stdout.trim()}`
}

const origin = widgetOrigin()
const widgetPreviewUrl = `${origin}/preview.html`
process.env.E2E_WIDGET_CDN_URL = `${origin}/widget.js`

export default defineConfig({
	forbidOnly: isCI,
	fullyParallel: false,
	outputDir: "test-results",
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	reporter: isCI ? [["line"], ["html", { open: "never" }]] : "list",
	retries: isCI ? 2 : 0,
	testDir: "./tests",
	use: {
		baseURL: "http://127.0.0.1:4173",
		screenshot: "only-on-failure",
		trace: "on-first-retry",
		video: "off",
	},
	webServer: [
		{
			command: "bun run dev",
			cwd: "../api",
			reuseExistingServer: !isCI,
			timeout: 120_000,
			url: "http://127.0.0.1:3000/health",
		},
		{
			// The embed's dev build; vite reads the port from TALQO_WIDGET_PORT.
			command: "bun run dev --host 127.0.0.1",
			cwd: "../widget",
			env: { TALQO_WIDGET_PORT: new URL(origin).port },
			reuseExistingServer: !isCI,
			timeout: 120_000,
			url: origin,
		},
		{
			command: "bun run dev --host 127.0.0.1 --port 4173",
			cwd: "../web",
			env: {
				// The embed snippet and the live preview need the widget origin
				// (see dashboard/-embed-snippet.ts, components/widget-preview.tsx).
				VITE_WIDGET_CDN_URL: process.env.E2E_WIDGET_CDN_URL,
				VITE_WIDGET_PREVIEW_URL: widgetPreviewUrl,
			},
			reuseExistingServer: !isCI,
			timeout: 120_000,
			url: "http://127.0.0.1:4173",
		},
	],
	workers: 1,
})
