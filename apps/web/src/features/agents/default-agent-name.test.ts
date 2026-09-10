import { describe, expect, it } from "bun:test"

import { nextDefaultAgentName } from "./default-agent-name"

describe("nextDefaultAgentName", () => {
	it("returns the base name when nothing is taken", () => {
		expect(nextDefaultAgentName([], "New agent")).toBe("New agent")
	})

	it("appends 2 when the base name is taken", () => {
		expect(nextDefaultAgentName(["New agent"], "New agent")).toBe("New agent 2")
	})

	it("finds the first free suffix", () => {
		expect(nextDefaultAgentName(["New agent", "New agent 2"], "New agent")).toBe("New agent 3")
	})

	it("ignores gaps: takes the lowest free suffix", () => {
		expect(nextDefaultAgentName(["New agent", "New agent 3"], "New agent")).toBe("New agent 2")
	})

	it("matches case-insensitively and skips taken suffixed names", () => {
		expect(nextDefaultAgentName(["NEW AGENT", "new agent 2"], "New agent")).toBe("New agent 3")
	})
})
