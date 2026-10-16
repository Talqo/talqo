import { describe, expect, it } from "bun:test"

import { effectivePermissions } from "./roles.service.ts"

describe("effectivePermissions", () => {
	it("keeps registry order and deduplicates overlapping grants", () => {
		expect(
			effectivePermissions([
				{ permission: "agents:read" },
				{ permission: "agents:manage" },
				{ permission: "ai_provider:manage" },
			]),
		).toEqual(["ai_provider:manage", "agents:read", "agents:manage"])
	})

	it("drops unknown grant strings", () => {
		expect(
			effectivePermissions([{ permission: "systems:aws" }, { permission: "constructor" }, { permission: "__proto__" }]),
		).toEqual([])
	})
})
