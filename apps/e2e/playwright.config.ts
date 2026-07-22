import { defineConfig, devices } from "@playwright/test"

const isCI = Boolean(process.env.CI)

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
			command: "bun run dev --host 127.0.0.1 --port 4173",
			cwd: "../web",
			reuseExistingServer: !isCI,
			timeout: 120_000,
			url: "http://127.0.0.1:4173",
		},
	],
	workers: 1,
})
