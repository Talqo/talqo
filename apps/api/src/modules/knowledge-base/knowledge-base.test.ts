import { describe, expect, it } from "bun:test"

import {
	BYTES_PER_MB,
	InvalidFileError,
	MAX_FILE_NAME_LENGTH,
	MAX_FILE_SIZE_BYTES,
	MAX_FILE_SIZE_MB,
	resolveRenameTarget,
	uploadExtension,
	validateName,
	validateUpload,
} from "./knowledge-base.service.ts"

describe("uploadExtension", () => {
	it("reports allowed extensions in lower case and everything else as other", () => {
		expect(uploadExtension("Guide.PDF")).toBe(".pdf")
		expect(uploadExtension("john-doe-contract.exe")).toBe("other")
		expect(uploadExtension("noext")).toBe("other")
	})
})

describe("validateUpload", () => {
	it("accepts an allowed type within the size limit", () => {
		expect(() => validateUpload({ name: "notes.md", size: 1 })).not.toThrow()
		expect(() => validateUpload({ name: "doc.PDF", size: MAX_FILE_SIZE_MB * BYTES_PER_MB })).not.toThrow()
	})

	it("rejects a disallowed extension", () => {
		expect(() => validateUpload({ name: "script.exe", size: 1 })).toThrow(InvalidFileError)
		expect(() => validateUpload({ name: "noext", size: 1 })).toThrow(InvalidFileError)
	})

	it("names the offending type and lists the allowed ones", () => {
		expect(() => validateUpload({ name: "script.exe", size: 1 })).toThrow(
			"File type .exe is not allowed; use DOCX, MD, PDF, TXT",
		)
		expect(() => validateUpload({ name: "script.EXE", size: 1 })).toThrow("File type .exe is not allowed")
		expect(() => validateUpload({ name: "noext", size: 1 })).toThrow("File type (none) is not allowed")
	})

	it("rejects a file above the size limit and names the limit", () => {
		expect(() => validateUpload({ name: "big.pdf", size: MAX_FILE_SIZE_BYTES + 1 })).toThrow(
			`File exceeds the ${MAX_FILE_SIZE_MB} MB size limit`,
		)
	})

	it("rejects a multibyte name that fits the character limit but exceeds 255 bytes", () => {
		const name = `${"é".repeat(252)}.md`
		expect(name.length).toBe(MAX_FILE_NAME_LENGTH)
		expect(() => validateUpload({ name, size: 1 })).toThrow(/255 byte limit/)
	})

	it("accepts a name at exactly 255 bytes", () => {
		expect(() => validateUpload({ name: `${"a".repeat(251)}.pdf`, size: 1 })).not.toThrow()
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
	it("does not duplicate the extension when already present", () => {
		expect(resolveRenameTarget("old.pdf", "new.pdf")).toBe("new.pdf")
	})

	it("trims and rejects an empty target", () => {
		expect(resolveRenameTarget("old.pdf", "  renamed  ")).toBe("renamed.pdf")
		expect(() => resolveRenameTarget("old.pdf", "   ")).toThrow("File name must not be empty")
	})

	it("validates the resulting name", () => {
		expect(() => resolveRenameTarget("old.pdf", "../x")).toThrow(InvalidFileError)
		expect(() => resolveRenameTarget("old.pdf", "a/b")).toThrow(InvalidFileError)
	})
})
