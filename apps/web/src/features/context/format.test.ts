import { describe, expect, test } from "bun:test"

import { formatBytes, splitExtension } from "./format"

describe("formatBytes", () => {
	test("uses the exact byte, kilobyte, and megabyte thresholds", () => {
		expect(formatBytes(1023)).toBe("1023 B")
		expect(formatBytes(1024)).toBe("1.0 KB")
		expect(formatBytes(1_048_575)).toBe("1024.0 KB")
		expect(formatBytes(1_048_576)).toBe("1.0 MB")
	})
})

describe("splitExtension", () => {
	test("treats dotfiles and no-extension names as extension-less", () => {
		expect(splitExtension(".gitignore")).toEqual({ base: ".gitignore", extension: "" })
		expect(splitExtension("README")).toEqual({ base: "README", extension: "" })
	})

	test("splits the final extension from normal and multi-dot names", () => {
		expect(splitExtension("guide.pdf")).toEqual({ base: "guide", extension: ".pdf" })
		expect(splitExtension("archive.tar.gz")).toEqual({ base: "archive.tar", extension: ".gz" })
	})
})
