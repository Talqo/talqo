import { describe, expect, test } from "bun:test"

import { formatFileDate, splitExtension } from "./format"

describe("formatFileDate", () => {
	test("returns the raw value for an unparseable date instead of throwing", () => {
		expect(formatFileDate("not-a-date", "en-US")).toBe("not-a-date")
	})
})

describe("splitExtension", () => {
	test("treats dotfiles and no-extension names as extension-less", () => {
		expect(splitExtension(".gitignore")).toEqual({ base: ".gitignore", extension: "" })
		expect(splitExtension("README")).toEqual({ base: "README", extension: "" })
	})
})
