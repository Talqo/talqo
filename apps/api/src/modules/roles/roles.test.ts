import { describe, expect, it } from "bun:test"

import { can, effectivePermissions, PERMISSIONS } from "./roles.service.ts"

describe("can", () => {
	it("lets an admin pass any check regardless of grants", () => {
		expect(can({ isAdmin: true }, [], "users:invite")).toBe(true)
	})

	it("denies a non-admin with no matching grant", () => {
		expect(can({ isAdmin: false }, [], "users:invite")).toBe(false)
	})

	it("allows a non-admin with the exact grant", () => {
		expect(can({ isAdmin: false }, [{ permission: "users:invite" }], "users:invite")).toBe(true)
	})

	it("denies a grant for a different permission", () => {
		expect(can({ isAdmin: false }, [{ permission: "users:invite" }], "agents:read")).toBe(false)
	})

	it("lets agents:manage satisfy an agents:read check", () => {
		expect(can({ isAdmin: false }, [{ permission: "agents:manage" }], "agents:read")).toBe(true)
	})

	it("does not let agents:read satisfy an agents:manage check", () => {
		expect(can({ isAdmin: false }, [{ permission: "agents:read" }], "agents:manage")).toBe(false)
	})

	it("ignores grant strings that are not known permissions", () => {
		expect(can({ isAdmin: false }, [{ permission: "agents:super" }], "agents:read")).toBe(false)
	})
})

describe("effectivePermissions", () => {
	it("gives an admin every registered permission", () => {
		expect(effectivePermissions(true, [])).toEqual([...PERMISSIONS])
	})

	it("denies a grant for a different permission", () => {
		expect(can({ isAdmin: false }, [{ permission: "users:invite" }], "agents:read")).toBe(false)
	})

	it("expands agents:manage into agents:read and agents:manage", () => {
		expect(effectivePermissions(false, [{ permission: "agents:manage" }])).toEqual(["agents:read", "agents:manage"])
	})

	it("keeps registry order and deduplicates overlapping grants", () => {
		expect(
			effectivePermissions(false, [
				{ permission: "agents:read" },
				{ permission: "agents:manage" },
				{ permission: "users:invite" },
			]),
		).toEqual(["users:invite", "agents:read", "agents:manage"])
	})

	it("drops unknown grant strings", () => {
		expect(effectivePermissions(false, [{ permission: "systems:aws" }])).toEqual([])
	})
})
