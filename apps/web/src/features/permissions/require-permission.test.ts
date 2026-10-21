import { describe, expect, test } from "bun:test"

import { accessGate } from "./require-permission.ts"

function query(overrides: Partial<Parameters<typeof accessGate>[1]> = {}) {
	return { isPending: false, isError: false, data: undefined, ...overrides }
}

const granted = query({ data: { data: { permissions: ["admin"] } } })

describe("accessGate", () => {
	test("uses the relevant agent capability rather than any agent access", () => {
		const permissions = query({ data: { data: { permissions: [] } } })
		const agents: NonNullable<Parameters<typeof accessGate>[2]> = {
			isPending: false,
			isError: false,
			data: {
				data: {
					agents: [
						{
							id: "a",
							name: "A",
							createdAt: "2026-10-20T00:00:00Z",
							updatedAt: "2026-10-20T00:00:00Z",
							permissions: ["stats:read"],
						},
					],
				},
			},
		}
		expect(accessGate("stats:read", permissions, agents)).toBe("open")
		expect(accessGate("agents:visible", permissions, agents)).toBe("open")
		expect(accessGate("conversations:read", permissions, agents)).toBe("denied")
		expect(accessGate("agents:read", permissions, agents)).toBe("denied")
	})

	test("distinguishes empty agent scopes, loading and failures", () => {
		const permissions = query({ data: { data: { permissions: [] } } })
		expect(accessGate("stats:read", permissions, { isPending: true, isError: false })).toBe("pending")
		expect(accessGate("stats:read", permissions, { isPending: false, isError: true })).toBe("error")
		expect(
			accessGate("stats:read", permissions, { isPending: false, isError: false, data: { data: { agents: [] } } }),
		).toBe("denied")
		expect(
			accessGate("stats:read", granted, { isPending: false, isError: false, data: { data: { agents: [] } } }),
		).toBe("open")
	})
	test("opens a route that requires nothing, even before permissions resolve", () => {
		expect(accessGate(undefined, query({ isPending: true }))).toBe("open")
	})

	test("opens a route whose requirement is held", () => {
		expect(accessGate("agents:read", granted)).toBe("open")
	})

	test("denies a route whose requirement is absent", () => {
		expect(accessGate("ai_provider:manage", query({ data: { data: { permissions: [] } } }))).toBe("denied")
	})

	// A failed request is not an authorization decision.
	test("reports an unresolved permission as pending, never as a denial", () => {
		expect(accessGate("admin", query({ isPending: true }))).toBe("pending")
	})

	test("reports a failed permission request as an error, never as a denial", () => {
		expect(accessGate("admin", query({ isError: true }))).toBe("error")
	})
})
