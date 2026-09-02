import { describe, expect, it } from "bun:test"

import { can, effectivePermissions, PERMISSIONS } from "./roles.service.ts"

describe("can", () => {
	it("lets an admin grant pass any check", () => {
		expect(can([{ permission: "admin" }], "users:invite")).toBe(true)
	})

	it("denies a non-admin with no matching grant", () => {
		expect(can([], "users:invite")).toBe(false)
	})

	it("allows a non-admin with the exact grant", () => {
		expect(can([{ permission: "users:invite" }], "users:invite")).toBe(true)
	})

	it("denies a grant for a different permission", () => {
		expect(can([{ permission: "users:invite" }], "agents:read")).toBe(false)
	})

	it("lets agents:manage satisfy an agents:read check", () => {
		expect(can([{ permission: "agents:manage" }], "agents:read")).toBe(true)
	})

	it("does not let agents:read satisfy an agents:manage check", () => {
		expect(can([{ permission: "agents:read" }], "agents:manage")).toBe(false)
	})

	it("ignores grant strings that are not known permissions", () => {
		expect(can([{ permission: "agents:super" }], "agents:read")).toBe(false)
	})
})

describe("effectivePermissions", () => {
	it("expands an admin grant into every registered permission", () => {
		expect(effectivePermissions([{ permission: "admin" }])).toEqual([...PERMISSIONS])
	})

	it("denies a grant for a different permission", () => {
		expect(effectivePermissions([{ permission: "users:invite" }])).toEqual(["users:invite"])
	})

	it("expands agents:manage into agents:read and agents:manage", () => {
		expect(effectivePermissions([{ permission: "agents:manage" }])).toEqual(["agents:read", "agents:manage"])
	})

	it("keeps registry order and deduplicates overlapping grants", () => {
		expect(
			effectivePermissions([
				{ permission: "agents:read" },
				{ permission: "agents:manage" },
				{ permission: "users:invite" },
			]),
		).toEqual(["users:invite", "agents:read", "agents:manage"])
	})

	it("drops unknown grant strings", () => {
		expect(effectivePermissions([{ permission: "systems:aws" }])).toEqual([])
	})

	it("ignores retained legacy agent-scoped grants", () => {
		const scopedGrant = { agentId: "agent-1", permission: "ai_provider:manage" }
		expect(effectivePermissions([scopedGrant])).toEqual([])
	})
})
