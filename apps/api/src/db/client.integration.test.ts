import { describe, expect, it } from "bun:test"

import { getSql } from "./client.ts"

describe("db client", () => {
	it("connects to the configured Postgres instance", async () => {
		const [row] = await getSql()<[{ result: number }]>`select 1 as result`

		expect(row?.result).toBe(1)
	})
})
