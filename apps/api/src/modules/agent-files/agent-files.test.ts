import { describe, expect, it } from "bun:test"

import {
	InvalidFileError,
	MAX_FILE_NAME_LENGTH,
	MAX_FILE_SIZE_MB,
	BYTES_PER_MB,
	resolveRenameTarget,
	validateName,
	validateUpload,
} from "./agent-files.service.ts"

describe("validateUpload", () => {
	it("accepts an allowed type within the size limit", () => {
		expect(() => validateUpload({ name: "notes.md", size: 1 })).not.toThrow()
		expect(() => validateUpload({ name: "doc.PDF", size: MAX_FILE_SIZE_MB * BYTES_PER_MB })).not.toThrow()
	})

	it("rejects a disallowed extension", () => {
		expect(() => validateUpload({ name: "script.exe", size: 1 })).toThrow(InvalidFileError)
		expect(() => validateUpload({ name: "noext", size: 1 })).toThrow(InvalidFileError)
	})

	it("rejects a file over the size limit", () => {
		expect(() => validateUpload({ name: "big.pdf", size: MAX_FILE_SIZE_MB * BYTES_PER_MB + 1 })).toThrow(
			InvalidFileError,
		)
	})

	it("rejects empty and overlong names", () => {
		expect(() => validateUpload({ name: "", size: 1 })).toThrow(InvalidFileError)
		expect(() => validateUpload({ name: `${"a".repeat(MAX_FILE_NAME_LENGTH)}.pdf`, size: 1 })).toThrow(InvalidFileError)
	})
})

describe("validateName", () => {
	it("rejects traversal and separators that arrive URL-decoded", () => {
		for (const name of ["../x", "a/b", "a\\b", "..", "a\0b"]) {
			expect(() => validateName(name)).toThrow(InvalidFileError)
		}
	})

	it("accepts a plain file name", () => {
		expect(() => validateName("report.pdf")).not.toThrow()
	})
})

describe("resolveRenameTarget", () => {
	it("keeps the original extension when the new name omits it", () => {
		expect(resolveRenameTarget("old.pdf", "new")).toBe("new.pdf")
	})

	it("does not duplicate the extension when already present", () => {
		expect(resolveRenameTarget("old.pdf", "new.pdf")).toBe("new.pdf")
	})

	it("trims and rejects an empty target", () => {
		expect(resolveRenameTarget("old.pdf", "  renamed  ")).toBe("renamed.pdf")
		expect(() => resolveRenameTarget("old.pdf", "   ")).toThrow(InvalidFileError)
	})
})
