import { describe, expect, it } from "bun:test"

import { sql } from "./client.ts"

describe("db client", () => {
	it("connects to the configured Postgres instance", async () => {
		const [row] = await sql<[{ result: number }]>`select 1 as result`

		expect(row?.result).toBe(1)
	})
})
