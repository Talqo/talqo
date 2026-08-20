import { describe, expect, it } from "bun:test"

import { InvalidNameError, validateName } from "./agents.files.ts"

describe("validateName", () => {
	it.each(["context.txt", "Refund Policy.md", "číselník.pdf", ".hidden.md"])("accepts %s", (name) => {
		expect(() => validateName(name)).not.toThrow()
	})

	it.each(["../escape.txt", "a/b.txt", "a\\b.txt", "...", "a..b.txt"])("rejects %s", (name) => {
		expect(() => validateName(name)).toThrow(InvalidNameError)
	})

	it("rejects an empty name", () => {
		expect(() => validateName("")).toThrow(InvalidNameError)
	})
})
