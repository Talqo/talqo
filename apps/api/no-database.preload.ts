import { mock } from "bun:test"

// Preloaded for database-free runs (unit tests, OpenAPI generation): executing a query fails loudly.
process.env.DATABASE_URL ??= "postgres://stub:stub@localhost:5432/stub"
process.env.NODE_ENV ??= "test"

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
