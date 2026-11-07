import { describe, expect, test } from "bun:test"

import { toEnvRecord } from "./mcp-env-variables"

describe("toEnvRecord", () => {
	test("uses a trimmed name as the request key for an entered secret", () => {
		expect(toEnvRecord([{ id: "h1", name: " X-API-Key ", value: "secret" }])).toEqual({
			"X-API-Key": "secret",
		})
	})

	test("omits incomplete rows instead of sending empty or unnamed secrets", () => {
		expect(
			toEnvRecord([
				{ id: "complete", name: "X-Complete", value: "secret" },
				{ id: "empty-value", name: "X-Empty", value: "" },
				{ id: "blank-name", name: " \t ", value: "orphan" },
			]),
		).toEqual({ "X-Complete": "secret" })
	})
})
