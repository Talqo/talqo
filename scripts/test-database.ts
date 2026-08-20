import { $ } from "bun"

const COMPOSE_TIMEOUT = "30"
const APP_SECRET_BYTES = 32
const POSTGRES_PORT = "5432"
const TEST_DATABASE = "talqo"
const TEST_PROFILE = "test"
const TEST_SERVICE = "postgres-test"
const TEST_APP_SECRET = Buffer.alloc(APP_SECRET_BYTES, 1).toString("base64url")

export type TestDatabaseEnv = Record<string, string | undefined>

export async function withTestDatabase(run: (env: TestDatabaseEnv) => Promise<void>): Promise<void> {
	const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
	let projectName: string | undefined
	let databaseUrl = Bun.env.DATABASE_URL

	try {
		if (!databaseUrl) {
			projectName = `talqo-test-${crypto.randomUUID().replaceAll("-", "")}`
			await $`docker compose --project-name ${projectName} --profile ${TEST_PROFILE} up --detach --wait --wait-timeout ${COMPOSE_TIMEOUT} ${TEST_SERVICE}`.cwd(
				root,
			)
			const address =
				await $`docker compose --project-name ${projectName} --profile ${TEST_PROFILE} port ${TEST_SERVICE} ${POSTGRES_PORT}`
					.cwd(root)
					.quiet()
					.text()
			const port = address.trim().split(":").at(-1)
			if (!port) throw new Error("Could not determine the test PostgreSQL port")
			databaseUrl = `postgres://talqo:talqo@127.0.0.1:${port}/${TEST_DATABASE}`
		}

		await run({
			...Bun.env,
			APP_SECRET: Bun.env.APP_SECRET ?? TEST_APP_SECRET,
			DATABASE_URL: databaseUrl,
			NODE_ENV: "test",
		})
	} finally {
		if (projectName) {
			await $`docker compose --project-name ${projectName} --profile ${TEST_PROFILE} down --volumes`.cwd(root)
		}
	}
}
