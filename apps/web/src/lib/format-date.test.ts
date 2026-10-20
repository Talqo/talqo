import { describe, expect, test } from "bun:test"

import { formatDay } from "./format-date"

describe("formatDay", () => {
	const now = new Date(2026, 9, 20, 9, 0)

	test("names today and yesterday and dates older days", () => {
		expect(formatDay(new Date(2026, 9, 20, 0, 5).toISOString(), "en", now)).toBe("today")
		expect(formatDay(new Date(2026, 9, 19, 23, 55).toISOString(), "en", now)).toBe("yesterday")
		expect(formatDay(new Date(2026, 9, 18, 12, 0).toISOString(), "en", now)).toBe("Sunday, October 18, 2026")
	})
})
