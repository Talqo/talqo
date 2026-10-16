import { describe, expect, it } from "bun:test"

import { nextDefaultName } from "./default-name"

describe("nextDefaultName", () => {
	it("finds the first free suffix", () => {
		expect(nextDefaultName(["New agent", "New agent 2"], "New agent")).toBe("New agent 3")
	})

	it("ignores gaps: takes the lowest free suffix", () => {
		expect(nextDefaultName(["New agent", "New agent 3"], "New agent")).toBe("New agent 2")
	})

	it("matches case-insensitively and skips taken suffixed names", () => {
		expect(nextDefaultName(["NEW AGENT", "new agent 2"], "New agent")).toBe("New agent 3")
	})
})
