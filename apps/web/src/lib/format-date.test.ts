import { describe, expect, test } from "bun:test"

import { formatDateTime, formatDay, formatTime } from "./format-date"

describe("formatDateTime", () => {
	test("renders a medium date with a short time in the active language", () => {
		expect(formatDateTime("2026-10-20T12:34:00", "en")).toBe("Oct 20, 2026, 12:34 PM")
	})
})

describe("formatTime", () => {
	test("renders a short time in the active language", () => {
		expect(formatTime("2026-10-20T12:34:00", "en")).toBe("12:34 PM")
	})
})

describe("formatDay", () => {
	const now = new Date(2026, 9, 20, 9, 0)

	test("names today and yesterday and dates older days", () => {
		expect(formatDay(new Date(2026, 9, 20, 0, 5).toISOString(), "en", now)).toBe("today")
		expect(formatDay(new Date(2026, 9, 19, 23, 55).toISOString(), "en", now)).toBe("yesterday")
		expect(formatDay(new Date(2026, 9, 18, 12, 0).toISOString(), "en", now)).toBe("Sunday, October 18, 2026")
	})
})
