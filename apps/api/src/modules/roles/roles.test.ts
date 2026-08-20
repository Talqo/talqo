import { describe, expect, it } from "bun:test"

import { can, effectivePermissions } from "./roles.service.ts"

describe("can", () => {
	it("lets an admin pass any check regardless of grants or resource", () => {
		expect(can({ isAdmin: true }, [], "users:invite", "some-agent-id")).toBe(true)
	})

	it("denies a non-admin with no matching grant", () => {
		expect(can({ isAdmin: false }, [], "users:invite")).toBe(false)
	})

	it("denies a grant scoped to one agent when checked against a different agent", () => {
		const grants = [{ agentId: "agent-a", permission: "users:invite" }]

		expect(can({ isAdmin: false }, grants, "users:invite", "agent-b")).toBe(false)
	})

	it("allows a grant scoped to an agent when checked against that same agent", () => {
		const grants = [{ agentId: "agent-a", permission: "users:invite" }]

		expect(can({ isAdmin: false }, grants, "users:invite", "agent-a")).toBe(true)
	})

	it("allows a null-scoped (global) grant regardless of which agent is checked", () => {
		const grants = [{ agentId: null, permission: "users:invite" }]

		expect(can({ isAdmin: false }, grants, "users:invite", "any-agent-id")).toBe(true)
		expect(can({ isAdmin: false }, grants, "users:invite")).toBe(true)
	})

	it("denies a grant for a different permission", () => {
		const grants = [{ agentId: null, permission: "some:other-permission" }]

		expect(can({ isAdmin: false }, grants, "users:invite")).toBe(false)
	})
})

describe("effectivePermissions", () => {
	it("returns every permission for an admin", () => {
		expect(effectivePermissions({ isAdmin: true }, [])).toContain("ai_provider:manage")
	})

	it("returns distinct global grants for an operator", () => {
		expect(
			effectivePermissions({ isAdmin: false }, [
				{ agentId: null, permission: "ai_provider:manage" },
				{ agentId: null, permission: "ai_provider:manage" },
				{ agentId: "agent-1", permission: "users:invite" },
			]),
		).toEqual(["ai_provider:manage"])
	})
})
