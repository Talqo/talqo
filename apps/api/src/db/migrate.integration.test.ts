import { describe, expect, it } from "bun:test"
import { sql } from "drizzle-orm"

import { db } from "./client.ts"
import { runMigrations } from "./migrate.ts"

describe("migrations", () => {
	it("applies cleanly against an empty database", async () => {
		await expect(runMigrations()).resolves.toBeUndefined()
	})

	it("backfills input-token estimates from previously stored Unicode prompts", async () => {
		const migration = await Bun.file(
			new URL("../../drizzle/0008_backfill-input-token-estimate.sql", import.meta.url),
		).text()
		await db.transaction(async (tx) => {
			await tx.execute(
				sql`CREATE TEMP TABLE generation_attempt (input_text text, estimated_input_tokens integer) ON COMMIT DROP`,
			)
			await tx.execute(sql`INSERT INTO generation_attempt (input_text) VALUES ('😀abcde')`)
			await tx.execute(sql.raw(migration))
			const result = await tx.execute(sql`SELECT estimated_input_tokens FROM generation_attempt`)
			expect(result[0]?.estimated_input_tokens).toBe(2)
		})
	})
})
