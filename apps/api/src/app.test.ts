import { describe, expect, it } from "bun:test"

import { app } from "./app.ts"

describe("api", () => {
	it("reports its health", async () => {
		const response = await app.request("/health")

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: "ok" })
	})
})
