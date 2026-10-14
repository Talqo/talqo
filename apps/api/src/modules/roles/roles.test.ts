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
		expect(effectivePermissions([{ permission: "systems:aws" }])).toEqual([])
	})

	it("ignores retained legacy agent-scoped grants", () => {
		const scopedGrant = { agentId: "agent-1", permission: "ai_provider:manage" }
		expect(effectivePermissions([scopedGrant])).toEqual([])
	})
})
