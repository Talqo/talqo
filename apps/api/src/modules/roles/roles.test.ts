import { describe, expect, it } from "bun:test"

import { effectiveAgentPermissions, effectivePermissions } from "./roles.service.ts"

describe("effectivePermissions", () => {
	it("keeps registry order and deduplicates overlapping grants", () => {
		expect(
			effectivePermissions([
				{ permission: "users:read" },
				{ permission: "users:manage" },
				{ permission: "ai_provider:manage" },
			]),
		).toEqual(["users:read", "users:manage", "ai_provider:manage"])
	})

	it("drops unknown grant strings", () => {
		expect(
			effectivePermissions([{ permission: "systems:aws" }, { permission: "constructor" }, { permission: "__proto__" }]),
		).toEqual([])
		expect(effectiveAgentPermissions(["unknown"])).toEqual([])
	})

	it("expands the admin grant to every permission", () => {
		expect(effectivePermissions([{ permission: "admin" }])).toEqual([
			"admin",
			"users:read",
			"users:manage",
			"roles:manage",
			"ai_provider:manage",
		])
	})

	it("adds the read access implied by manage grants", () => {
		expect(effectivePermissions([{ permission: "users:manage" }])).toEqual(["users:read", "users:manage"])
		expect(effectivePermissions([{ permission: "roles:manage" }])).toEqual(["users:read", "roles:manage"])
	})

	it("implies agent read from manage or delete but never the reverse", () => {
		expect(effectiveAgentPermissions(["agents:manage"])).toEqual(["agents:read", "agents:manage"])
		expect(effectiveAgentPermissions(["agents:delete"])).toEqual(["agents:read", "agents:delete"])
		expect(effectiveAgentPermissions(["agents:read"])).toEqual(["agents:read"])
	})
})
