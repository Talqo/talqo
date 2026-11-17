import { describe, expect, test } from "bun:test"

import { USERNAME_PATTERN } from "./credentials"

describe("USERNAME_PATTERN", () => {
	test.each(["shop_admin-1", "A9_-", "abc"])("accepts %s", (value) => {
		expect(USERNAME_PATTERN.test(value)).toBe(true)
	})

	test.each(["ab cd", "admin!", "admin@example.com", "üser", "ü!", ""])("rejects %s", (value) => {
		expect(USERNAME_PATTERN.test(value)).toBe(false)
	})
})
