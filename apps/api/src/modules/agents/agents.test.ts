import { describe, expect, it } from "bun:test"

import type { Agent } from "./agents.repository.ts"

import { toPublicAgent } from "./agents.service.ts"

function makeAgent(overrides: Partial<Agent> = {}): Agent {
	return {
		id: "agent-1",
		ownerId: "user-1",
		name: "Support bot",
		systemPrompt: "You are helpful.",
		wordBlacklist: ["spam"],
		active: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	}
}

describe("toPublicAgent", () => {
	it("maps active=true to status 'active'", () => {
		expect(toPublicAgent(makeAgent()).status).toBe("active")
	})

	it("maps active=false to status 'paused'", () => {
		expect(toPublicAgent(makeAgent({ active: false })).status).toBe("paused")
	})

	it("always exposes a null avatarUrl until avatar upload ships", () => {
		expect(toPublicAgent(makeAgent()).avatarUrl).toBeNull()
	})

	it("does not leak the owner id", () => {
		expect(toPublicAgent(makeAgent())).not.toHaveProperty("ownerId")
	})
})
