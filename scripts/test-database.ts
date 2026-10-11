import { $ } from "bun"

const COMPOSE_TIMEOUT = "30"
const POSTGRES_PORT = "5432"
const TEST_DATABASE = "talqo"
const TEST_PROFILE = "test"
const TEST_SERVICE = "postgres-test"
const TEST_APP_SECRET_BYTES = 32
const TEST_APP_SECRET = Buffer.alloc(TEST_APP_SECRET_BYTES, 1).toString("base64url")

export type TestDatabaseEnv = Record<string, string | undefined>

export type TestPostgres = {
	root: string
	projectName: string
	port: string
}

export async function startTestPostgres(): Promise<TestPostgres> {
	const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
	const projectName = `talqo-test-${crypto.randomUUID().replaceAll("-", "")}`
	try {
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
		return { root, projectName, port }
	} catch (error) {
		await stopTestPostgres({ root, projectName, port: POSTGRES_PORT }).catch(() => undefined)
		throw error
	}
}

export async function stopTestPostgres(postgres: TestPostgres): Promise<void> {
	await $`docker compose --project-name ${postgres.projectName} --profile ${TEST_PROFILE} down --volumes`.cwd(
		postgres.root,
	)
}

export function databaseUrl(port: string, database: string): string {
	return `postgres://talqo:talqo@127.0.0.1:${port}/${database}`
}

export function testAppSecret(): string {
	return TEST_APP_SECRET
}

export async function createDatabase(postgres: TestPostgres, database: string, template?: string): Promise<void> {
	const templateArgs = template ? ["TEMPLATE", template] : []
	await $`docker compose --project-name ${postgres.projectName} --profile ${TEST_PROFILE} exec -T ${TEST_SERVICE} psql -U talqo -d postgres -v ON_ERROR_STOP=1 -c ${[`CREATE DATABASE "${database}"`, ...templateArgs].join(" ")}`
		.cwd(postgres.root)
		.quiet()
}

export async function withTestDatabase(run: (env: TestDatabaseEnv) => Promise<void>): Promise<void> {
	const postgres = await startTestPostgres()
	try {
		await run({
			...Bun.env,
			APP_SECRET: TEST_APP_SECRET,
			DATABASE_URL: databaseUrl(postgres.port, TEST_DATABASE),
			NODE_ENV: "test",
		})
	} finally {
		await stopTestPostgres(postgres)
	}
}
