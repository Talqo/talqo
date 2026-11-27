import { captureClientTools } from "@/client-tools.ts"
import { expect, test } from "bun:test"
import { z } from "zod"

import { createPageTool } from "./page-tool.ts"

test("advertises an object-root tool schema accepted by structured-output providers without touching the DOM", async () => {
	const page = createPageTool({ exclude: [], language: "en" })
	const manifest = await captureClientTools({ talqo_page: page.definition }).manifest()
	expect(manifest[0]?.inputSchema.type).toBe("object")
	expect(manifest[0]?.inputSchema).not.toHaveProperty("anyOf")
	expect(JSON.stringify(manifest[0]?.inputSchema)).not.toContain('"oneOf"')
	expect(manifest[0]?.inputSchema).toHaveProperty("properties.action.type", "string")
})

test("describes approval as an on-page action, not a chat question", async () => {
	const page = createPageTool({ exclude: [], language: "en" })
	const manifest = await captureClientTools({ talqo_page: page.definition }).manifest()
	expect(manifest[0]?.description).toContain("do not ask for approval in chat")
})

test("reports incomplete actions before browser execution", async () => {
	const page = createPageTool({ exclude: [], language: "en" })
	const tools = captureClientTools({ talqo_page: page.definition })
	const result = await tools.execute(
		{
			version: 1,
			type: "tool-call",
			toolCallId: "incomplete",
			toolName: "talqo_page",
			input: { action: "fill", snapshot: "current", index: 0, approval: null },
			messages: [],
		},
		new AbortController().signal,
	)
	const invalid = z.object({ status: z.literal("invalid"), message: z.string() }).parse(result)
	expect(invalid.message).toContain("text")
})
