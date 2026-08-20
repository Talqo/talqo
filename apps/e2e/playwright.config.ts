import { defineConfig, devices } from "@playwright/test"

import { getFreePort } from "./get-free-port"

const isCI = Boolean(process.env.CI)
const CI_RETRIES = 2
const apiPort = process.env.TALQO_API_PORT ?? "3000"
const webPort = process.env.TALQO_WEB_PORT ?? "4173"
const widgetPort = process.env.TALQO_WIDGET_PORT ?? String(await getFreePort())
const providerPort = process.env.E2E_PROVIDER_PORT ?? String(await getFreePort())

const widgetOrigin = process.env.E2E_WIDGET_CDN_URL
	? new URL(process.env.E2E_WIDGET_CDN_URL).origin
	: `http://localhost:${widgetPort}`
const webOrigin = `http://127.0.0.1:${webPort}`

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
	retries: isCI ? CI_RETRIES : 0,
	testDir: "./tests",
	use: {
		baseURL: webOrigin,
		screenshot: "only-on-failure",
		trace: "on-first-retry",
		video: "off",
	},
	webServer: [
		{
			command: "bun run fake-provider.ts",
			cwd: ".",
			reuseExistingServer: false,
			timeout: 120_000,
			url: `http://127.0.0.1:${providerPort}/health`,
		},
		{
			command: "bun run dev",
			cwd: "../api",
			reuseExistingServer: false,
			timeout: 120_000,
			url: `http://127.0.0.1:${apiPort}/health`,
		},
		{
			command: "bun run dev --host 127.0.0.1",
			cwd: "../widget",
			env: { TALQO_WIDGET_PORT: new URL(widgetOrigin).port },
			reuseExistingServer: false,
			timeout: 120_000,
			url: widgetOrigin,
		},
		{
			command: `bun run dev --host 127.0.0.1 --port ${webPort}`,
			cwd: "../web",
			env: {
				VITE_WIDGET_CDN_URL: process.env.E2E_WIDGET_CDN_URL,
				VITE_WIDGET_PREVIEW_URL: widgetPreviewUrl,
			},
			reuseExistingServer: false,
			timeout: 120_000,
			url: webOrigin,
		},
	],
	workers: 1,
})
