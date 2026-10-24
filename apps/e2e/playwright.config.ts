import { defineConfig, devices } from "@playwright/test"
import path from "node:path"

const isCI = Boolean(process.env.CI)
const CI_RETRIES = 2
const ROOT = path.resolve(import.meta.dirname, "../..")
const postgresContainer = process.env.E2E_POSTGRES_CONTAINER ?? `talqo-e2e-${crypto.randomUUID()}`
process.env.E2E_POSTGRES_CONTAINER = postgresContainer

export default defineConfig({
	forbidOnly: isCI,
	fullyParallel: true,
	outputDir: "test-results",
	projects: [
		{ name: "chromium", use: { ...devices["Desktop Chrome"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "webkit", use: { ...devices["Desktop Safari"] } },
	],
	reporter: isCI ? [["line"], ["html", { open: "never" }]] : "list",
	retries: isCI ? CI_RETRIES : 0,
	testDir: "./tests",
	timeout: 60_000,
	use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
	workers: 4,
	webServer: {
		name: "PostgreSQL",
		command: `exec docker compose --project-name ${postgresContainer} --profile test run --rm --interactive=false --name ${postgresContainer} --service-ports --no-deps postgres-test`,
		cwd: ROOT,
		wait: { stderr: /listening on IPv4[\s\S]*database system is ready to accept connections/ },
		gracefulShutdown: { signal: "SIGINT", timeout: 10_000 },
	},
})
