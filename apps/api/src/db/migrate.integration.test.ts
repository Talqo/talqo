import { describe, expect, it } from "bun:test"

import { runMigrations } from "./migrate.ts"

describe("migrations", () => {
	it("applies cleanly against an empty database", async () => {
		await expect(runMigrations()).resolves.toBeUndefined()
	})
})
