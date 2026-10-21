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
	})
})

describe("effectiveAgentPermissions", () => {
	it("editing implies configuration viewing without transcripts, statistics or deletion", () => {
		expect(effectiveAgentPermissions(["agents:manage", "agents:read"])).toEqual(["agents:read", "agents:manage"])
	})
	it("conversation and statistics access do not imply configuration access", () => {
		expect(effectiveAgentPermissions(["stats:read", "conversations:read", "unknown"])).toEqual([
			"stats:read",
			"conversations:read",
		])
	})
})
