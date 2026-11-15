import { afterAll, mock, spyOn } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import postgres from "postgres"

// Keeps request logs out of test output; wide-event tests inject their own sink.
await mock.module("@/http/wide-event-stdout.ts", () => ({
	stdoutWideEventLog: { write: () => undefined, flush: () => undefined },
}))

const templateUrl = process.env.TALQO_TEST_TEMPLATE_URL
const uploadRoot = process.env.TALQO_TEST_UPLOAD_ROOT
if (!templateUrl || !uploadRoot) throw new Error("Run integration tests with bun run test:integration")

const template = new URL(templateUrl)
const database = `talqo_file_${crypto.randomUUID().replaceAll("-", "")}`
const admin = postgres(templateUrl, { database: "postgres", max: 1 })
try {
	// A killed run cannot drop its database, so reclaim ones left idle by earlier runs.
	try {
		const stale = await admin<{ datname: string }[]>`
			SELECT datname FROM pg_database d
			WHERE starts_with(datname, 'talqo_file_')
				AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)
				AND (pg_stat_file('base/' || d.oid || '/PG_VERSION')).modification < now() - interval '10 minutes'
		`
		await Promise.all(stale.map(({ datname }) => admin`DROP DATABASE IF EXISTS ${admin(datname)} WITH (FORCE)`))
	} catch {
		// A concurrent run reclaimed the same databases first; the new database is unaffected.
	}
	await admin`CREATE DATABASE ${admin(database)} TEMPLATE ${admin(template.pathname.slice(1))}`
} finally {
	await admin.end()
}
template.pathname = `/${database}`
process.env.DATABASE_URL = template.href
const uploadDirectory = await mkdtemp(path.join(uploadRoot, "file-"))
process.env.TALQO_UPLOAD_DIR = uploadDirectory

afterAll(async () => {
	const { sql } = await import("./src/db/client.ts")
	await sql.end()
	const cleanup = postgres(templateUrl, { database: "postgres", max: 1 })
	try {
		await cleanup`DROP DATABASE ${cleanup(database)} WITH (FORCE)`
	} finally {
		await cleanup.end()
		await rm(uploadDirectory, { recursive: true, force: true })
	}
})

const MINIMUM_PASSWORD_HASH_MEMORY_KIB = 8
const MINIMUM_PASSWORD_HASH_TIME_COST = 1
const originalPasswordHash = Bun.password.hash.bind(Bun.password)

spyOn(Bun.password, "hash").mockImplementation((password) =>
	originalPasswordHash(password, {
		algorithm: "argon2id",
		memoryCost: MINIMUM_PASSWORD_HASH_MEMORY_KIB,
		timeCost: MINIMUM_PASSWORD_HASH_TIME_COST,
	}),
)
