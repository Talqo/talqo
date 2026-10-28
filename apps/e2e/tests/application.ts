import { type APIRequestContext, expect, request as apiRequest, test as base } from "@playwright/test"
import { $, type Subprocess } from "bun"
import { mkdir, open } from "node:fs/promises"
import path from "node:path"

import { ADMIN } from "./log-in"
import { createTestServer } from "./test-server"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const WORKER_SETUP_TIMEOUT = 60_000
const APP_SECRET_BYTES = 32

type Application = {
	origin: string
	providerOrigin: string
	widgetHostOrigin: string
	logPath: string
}

export const test = base.extend<
	{
		localNetwork: void
		agent: { id: string; name: string }
	},
	{ application: Application; stdioAllowed: boolean; adminRequest: APIRequestContext }
>({
	stdioAllowed: [true, { scope: "worker", option: true }],
	adminRequest: [
		async ({ application }, use) => {
			const request = await apiRequest.newContext({ baseURL: application.origin })
			try {
				await expect(await request.post("/api/auth/login", { data: ADMIN })).toBeOK()
				await use(request)
			} finally {
				await request.dispose()
			}
		},
		{ scope: "worker" },
	],
	agent: async ({ adminRequest: request }, use) => {
		const name = `Agent ${crypto.randomUUID()}`
		const response = await request.post("/api/agents", {
			data: { name, systemPrompt: "Answer questions about our website.", wordBlacklist: ["Intercom"] },
		})
		await expect(response).toBeOK()
		const body: unknown = await response.json()
		if (
			!body ||
			typeof body !== "object" ||
			!("agent" in body) ||
			!body.agent ||
			typeof body.agent !== "object" ||
			!("id" in body.agent) ||
			typeof body.agent.id !== "string"
		) {
			throw new Error("Created agent response is missing its id")
		}
		const id = body.agent.id
		await use({ id, name })
		const embedsResponse = await request.get("/api/embeds", { params: { agentId: id } })
		await expect(embedsResponse).toBeOK()
		const embedList: unknown = await embedsResponse.json()
		if (!embedList || typeof embedList !== "object" || !("embeds" in embedList) || !Array.isArray(embedList.embeds))
			throw new Error("Embed list response is missing its embeds")
		const embeds: unknown[] = embedList.embeds
		await Promise.all(
			embeds.map(async (embed) => {
				if (!embed || typeof embed !== "object" || !("id" in embed) || typeof embed.id !== "string")
					throw new Error("Embed response is missing its id")
				await expect(await request.delete(`/api/embeds/${embed.id}`)).toBeOK()
			}),
		)
		await expect(await request.delete(`/api/agents/${id}`)).toBeOK()
	},
	application: [
		async ({ browserName, stdioAllowed }, use, workerInfo) => {
			const container = process.env.E2E_POSTGRES_CONTAINER
			if (!container) throw new Error(`Playwright did not start PostgreSQL for ${browserName}`)
			const database = `e2e_${workerInfo.workerIndex}`
			const directory = path.join(workerInfo.project.outputDir, "workers", String(workerInfo.workerIndex))
			await mkdir(directory, { recursive: true })
			const logPath = path.join(directory, "api.log")
			const log = await open(logPath, "w")
			const server = createTestServer()
			const providerOrigin = server.url.origin
			let api: Subprocess | undefined
			const errors: unknown[] = []
			try {
				const address = (await $`docker port ${container} 5432`.quiet().text()).trim()
				await $`docker exec ${container} psql -U talqo -d postgres -v ON_ERROR_STOP=1 -c ${`CREATE DATABASE ${database}`}`.quiet()
				const env = {
					PATH: process.env.PATH,
					HOME: process.env.HOME,
					NODE_ENV: "test",
					APP_SECRET: Buffer.alloc(APP_SECRET_BYTES, 1).toString("base64url"),
					DATABASE_URL: `postgres://talqo:talqo@${address}/${database}`,
					TALQO_API_PORT: "0",
					TALQO_UPLOAD_DIR: path.join(directory, "uploads"),
					TALQO_SERVE_STATIC: "true",
					TALQO_WEB_DIST: path.join(ROOT, "apps/web/dist"),
					TALQO_WIDGET_DIST: path.join(ROOT, "apps/widget/dist"),
					TALQO_CHAT_DAILY_MESSAGE_LIMIT: "3",
					TALQO_MCP_ALLOW_STDIO: String(stdioAllowed),
					TALQO_ALLOW_INSECURE_SEED: "true",
					TALQO_DOCLING_URL: providerOrigin,
					TALQO_SEED_AI_BASE_URL: `${providerOrigin}/v1`,
					TALQO_SEED_AI_API_KEY: "e2e-provider-key",
					TALQO_SEED_TEXT_MODEL: "chat-model",
					TALQO_SEED_EMBEDDING_MODEL: "embedding-model",
				}
				const cwd = path.join(ROOT, "apps/api")
				await $`bun --no-env-file src/db/migrate.ts`.cwd(cwd).env(env).quiet()
				await $`bun --no-env-file src/db/seed.ts`.cwd(cwd).env(env).quiet()
				const apiProcess = Bun.spawn(["bun", "--no-env-file", "--no-orphans", "src/index.ts"], {
					cwd,
					env,
					detached: true,
					stdin: "ignore",
					stdout: log.fd,
					stderr: log.fd,
				})
				api = apiProcess
				let origin = ""
				await expect
					.poll(
						async () => {
							const output = await Bun.file(logPath).text()
							if (apiProcess.exitCode !== null)
								throw new Error(`API exited during startup (${apiProcess.exitCode})\n${output}`)
							const port = /API listening on http:\/\/localhost:(\d+)/.exec(output)?.[1]
							origin = port ? `http://127.0.0.1:${port}` : ""
							return origin
						},
						{ message: `API startup log: ${logPath}`, timeout: WORKER_SETUP_TIMEOUT },
					)
					.not.toBe("")
				await use({ origin, providerOrigin, widgetHostOrigin: providerOrigin, logPath })
			} catch (error) {
				errors.push(error)
			}
			const results = await Promise.allSettled([
				(async () => {
					if (api?.exitCode === null) api.kill()
					await api?.exited
					await log.close()
				})(),
				server.stop(true),
			])
			const databaseResults = await Promise.allSettled([
				$`docker exec ${container} psql -U talqo -d postgres -v ON_ERROR_STOP=1 -c ${`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`}`.quiet(),
			])
			for (const result of [...results, ...databaseResults]) {
				if (result.status === "rejected") errors.push(result.reason)
			}
			if (errors.length) throw new AggregateError(errors, "Worker environment cleanup failed")
		},
		{ scope: "worker", timeout: WORKER_SETUP_TIMEOUT },
	],
	baseURL: async ({ application }, use) => {
		await use(application.origin)
	},
	localNetwork: [
		async ({ context, application }, use, testInfo) => {
			const allowedOrigins = new Set([application.origin, application.widgetHostOrigin])
			const blockedOrigins = new Set<string>()
			await context.route("**/*", async (route) => {
				const { origin } = new URL(route.request().url())
				if (allowedOrigins.has(origin)) await route.continue()
				else {
					blockedOrigins.add(origin)
					await route.abort("blockedbyclient")
				}
			})
			await use()
			if (testInfo.status !== testInfo.expectedStatus)
				await testInfo.attach("API log", { path: application.logPath, contentType: "text/plain" })
			expect([...blockedOrigins], "Browser requests must stay inside the test environment").toEqual([])
		},
		{ auto: true },
	],
})
