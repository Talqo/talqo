import { defineConfig, devices } from "@playwright/test"

import { getFreePort } from "./get-free-port"

const isCI = Boolean(process.env.CI)

// Config is loaded once by the test runner and again in each worker; the
// worker inherits the runner's env, so resolving the port only when the URL
// is unset keeps every process on the same value.
const widgetOrigin = process.env.E2E_WIDGET_CDN_URL
	? new URL(process.env.E2E_WIDGET_CDN_URL).origin
	: `http://localhost:${await getFreePort()}`

const widgetPreviewUrl = `${widgetOrigin}/preview.html`
process.env.E2E_WIDGET_CDN_URL = `${widgetOrigin}/widget.js`

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
			env: { TALQO_WIDGET_PORT: new URL(widgetOrigin).port },
			reuseExistingServer: !isCI,
			timeout: 120_000,
			url: widgetOrigin,
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
