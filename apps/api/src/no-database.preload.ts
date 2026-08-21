import { mock } from "bun:test"

// Makes module imports hermetic for database-free consumers (unit tests,
// OpenAPI document generation). Any code path that actually executes a
// database query fails loudly instead of silently connecting. Integration
// tests run without this preload and use the real client.
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
