import { afterAll, describe, expect, it } from "bun:test"

import { sql } from "./client.ts"
import { runMigrations } from "./migrate.ts"

describe("migrations", () => {
	afterAll(async () => {
		await sql.end()
	})

	it("applies cleanly against an empty database", async () => {
		await expect(runMigrations()).resolves.toBeUndefined()
	})
})
