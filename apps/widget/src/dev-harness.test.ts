import { expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import path from "node:path"

test("uses the development embed token supplied by the dev runner", async () => {
	const html = await readFile(path.resolve(import.meta.dirname, "../index.html"), "utf8")

	expect(html).toContain('data-talqo-embed-token="%VITE_WIDGET_DEMO_EMBED_TOKEN%"')
})
