import { afterAll, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"

import { migrateLegacyUploadLayout, uploadAreaDir } from "./upload-storage.ts"

const UPLOAD_ROOT = process.env.TALQO_UPLOAD_DIR
if (!UPLOAD_ROOT) throw new Error("TALQO_UPLOAD_DIR must be set; run via bun run test:integration")
const KNOWLEDGE_ROOT = uploadAreaDir("knowledge")

async function place(path: string, contents: string) {
	await mkdir(join(path, ".."), { recursive: true })
	await writeFile(path, contents)
}

beforeEach(async () => {
	await rm(UPLOAD_ROOT, { force: true, recursive: true })
})

afterAll(async () => {
	await rm(UPLOAD_ROOT, { force: true, recursive: true })
})

describe("legacy upload layout migration", () => {
	it("moves agent directories under knowledge/ and leaves the upload areas alone", async () => {
		await place(join(UPLOAD_ROOT, "agent-a", "guide.md"), "a")
		await place(join(UPLOAD_ROOT, "agent-b", "faq.pdf"), "b")
		await place(join(uploadAreaDir("embeds"), "embed-1", "icon.svg"), "<svg></svg>")
		await place(join(UPLOAD_ROOT, "stray.txt"), "left as is")

		await migrateLegacyUploadLayout()

		expect((await readdir(UPLOAD_ROOT)).toSorted()).toEqual(["embeds", "knowledge", "stray.txt"])
		expect(await readFile(join(KNOWLEDGE_ROOT, "agent-a", "guide.md"), "utf8")).toBe("a")
		expect(await readFile(join(KNOWLEDGE_ROOT, "agent-b", "faq.pdf"), "utf8")).toBe("b")
		expect(await readdir(join(uploadAreaDir("embeds"), "embed-1"))).toEqual(["icon.svg"])
	})

	it("merges into a directory created on the new layout without overwriting its files", async () => {
		await place(join(UPLOAD_ROOT, "agent-a", "old.md"), "legacy")
		await place(join(UPLOAD_ROOT, "agent-a", "shared.md"), "legacy copy")
		await place(join(KNOWLEDGE_ROOT, "agent-a", "shared.md"), "new copy")

		await migrateLegacyUploadLayout()

		expect(await readFile(join(KNOWLEDGE_ROOT, "agent-a", "old.md"), "utf8")).toBe("legacy")
		expect(await readFile(join(KNOWLEDGE_ROOT, "agent-a", "shared.md"), "utf8")).toBe("new copy")
		// The conflicting file stays put rather than being lost or overwriting the newer one.
		expect(await readdir(join(UPLOAD_ROOT, "agent-a"))).toEqual(["shared.md"])
	})

	it("is a no-op on the new layout and on a rerun", async () => {
		await place(join(UPLOAD_ROOT, "agent-a", "guide.md"), "a")
		await migrateLegacyUploadLayout()

		await migrateLegacyUploadLayout()

		expect(await readdir(UPLOAD_ROOT)).toEqual(["knowledge"])
		expect(await readFile(join(KNOWLEDGE_ROOT, "agent-a", "guide.md"), "utf8")).toBe("a")
	})

	it("never creates a missing root, so unmounted storage stays detectable", async () => {
		await migrateLegacyUploadLayout()

		await expect(stat(UPLOAD_ROOT)).rejects.toMatchObject({ code: "ENOENT" })
	})
})
