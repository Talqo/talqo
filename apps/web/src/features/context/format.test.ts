import { describe, expect, test } from "bun:test"

import { formatBytes, formatFileDate, splitExtension } from "./format"

describe("formatBytes", () => {
	test("shows bytes below 1 KB as B", () => {
		expect(formatBytes(0)).toBe("0 B")
		expect(formatBytes(512)).toBe("512 B")
		expect(formatBytes(1023)).toBe("1023 B")
	})

	test("shows kilobytes up to 1 MB", () => {
		expect(formatBytes(1024)).toBe("1.0 KB")
		expect(formatBytes(1536)).toBe("1.5 KB")
	})

	test("shows megabytes at and above 1 MB", () => {
		expect(formatBytes(1024 * 1024)).toBe("1.0 MB")
		expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB")
	})
})

describe("formatFileDate", () => {
	test("formats an ISO timestamp with date and time", () => {
		const formatted = formatFileDate("2026-08-25T14:30:00.000Z", "en-US")
		expect(formatted).toContain("Aug")
		expect(formatted).toContain("25")
		expect(formatted).toContain("2026")
	})

	test("respects the language", () => {
		expect(formatFileDate("2026-08-25T14:30:00.000Z", "cs-CZ")).toContain("25")
	})
})

describe("splitExtension", () => {
	test("splits base and extension", () => {
		expect(splitExtension("notes.pdf")).toEqual({ base: "notes", extension: ".pdf" })
	})

	test("treats dotfiles and no-extension names as extension-less", () => {
		expect(splitExtension(".gitignore")).toEqual({ base: ".gitignore", extension: "" })
		expect(splitExtension("README")).toEqual({ base: "README", extension: "" })
	})
})
