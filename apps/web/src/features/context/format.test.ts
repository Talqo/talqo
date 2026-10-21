import { describe, expect, test } from "bun:test"

import { splitExtension } from "./format"

describe("splitExtension", () => {
	test("treats dotfiles and no-extension names as extension-less", () => {
		expect(splitExtension(".gitignore")).toEqual({ base: ".gitignore", extension: "" })
		expect(splitExtension("README")).toEqual({ base: "README", extension: "" })
	})
})
