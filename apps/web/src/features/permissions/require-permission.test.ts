import { describe, expect, test } from "bun:test"

import { accessGate, type Permission } from "./require-permission.ts"

function query(overrides: Partial<Parameters<typeof accessGate>[1]> = {}) {
	return { isPending: false, isError: false, data: undefined, ...overrides }
}

const granted = query({ data: { data: { permissions: ["admin", "agents:read"] } } })

describe("accessGate", () => {
	test("opens a route that requires nothing, even before permissions resolve", () => {
		expect(accessGate(undefined, query({ isPending: true }))).toBe("open")
	})

	test("opens a route whose requirement is held", () => {
		expect(accessGate("agents:read", granted)).toBe("open")
	})

	test("denies a route whose requirement is absent", () => {
		expect(accessGate("ai_provider:manage", granted)).toBe("denied")
	})

	// A failed request is not an authorization decision.
	test("reports an unresolved permission as pending, never as a denial", () => {
		expect(accessGate("admin", query({ isPending: true }))).toBe("pending")
	})

	test("reports a failed permission request as an error, never as a denial", () => {
		expect(accessGate("admin", query({ isError: true }))).toBe("error")
	})
})

describe("requirePermission", () => {
	test("carries the requirement into route context", async () => {
		const { requirePermission } = await import("./require-permission.ts")
		const permission: Permission = "ai_provider:manage"

		expect(requirePermission(permission)()).toEqual({ requires: permission })
	})
})
