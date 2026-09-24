import { mock } from "bun:test"

// Preloaded for database-free runs (unit tests, OpenAPI generation).
const TEST_SECRET_BYTES = 32

process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub"
process.env.NODE_ENV ??= "test"
process.env.APP_SECRET ??= Buffer.alloc(TEST_SECRET_BYTES, 1).toString("base64url")

const unreachable = (): never => {
	throw new Error("No database available: this run must not execute queries")
}

const databaseStub: unknown = new Proxy(unreachable, {
	get: () => databaseStub,
	apply: () => unreachable(),
})

mock.module("@/db/client.ts", () => ({
	db: databaseStub,
	sql: databaseStub,
}))
