import { $ } from "bun"

import {
	createDatabase,
	databaseUrl,
	startTestPostgres,
	stopTestPostgres,
	testAppSecret,
	type TestDatabaseEnv,
} from "./test-database.ts"

const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
const apiDirectory = `${root}/apps/api`
const workerCount = Math.max(1, Number(process.env.TALQO_TEST_WORKERS ?? navigator.hardwareConcurrency) || 1)
const runId = crypto.randomUUID().replaceAll("-", "")

const postgres = await startTestPostgres()
let failed = false
try {
	const template = `talqo_template_${runId}`
	await createDatabase(postgres, template)
	const templateUrl = databaseUrl(postgres.port, template)
	const baseEnv: TestDatabaseEnv = {
		...Bun.env,
		APP_SECRET: testAppSecret(),
		DATABASE_URL: templateUrl,
		NODE_ENV: "test",
	}
	await $`bun run db:migrate`.cwd(apiDirectory).env(baseEnv)

	const databaseUrls = await Promise.all(
		Array.from({ length: workerCount }, async (_, index) => {
			const database = `talqo_worker_${runId}_${index}`
			await createDatabase(postgres, database, template)
			return databaseUrl(postgres.port, database)
		}),
	)
	const uploadBase = `${root}/tmp/test-uploads`
	await $`mkdir -p ${databaseUrls.map((_, index) => `${uploadBase}/worker-${index}`)}`.cwd(root)

	await $`bun test integration.test.ts --parallel --no-isolate --preload ./test-database.preload.ts`
		.cwd(apiDirectory)
		.env({ ...baseEnv, TALQO_TEST_DATABASE_URLS: databaseUrls.join(","), TALQO_UPLOAD_DIR: uploadBase })
} catch (error) {
	failed = true
	throw error
} finally {
	await stopTestPostgres(postgres).catch((error: unknown) => {
		if (!failed) throw error
		console.error("Failed to stop the test PostgreSQL container:", error)
	})
}
