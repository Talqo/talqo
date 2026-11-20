import { describe, expect, test } from "bun:test"

import { groupTranscriptParts } from "./chat-transcript"

function tool(toolCallId: string) {
	return { type: "dynamic-tool" as const, toolCallId }
}

describe("groupTranscriptParts", () => {
	test("collects adjacent tool calls and skips hidden parts", () => {
		const groups = groupTranscriptParts([
			{ type: "step-start" },
			tool("a"),
			{ type: "text", text: "" },
			tool("b"),
			tool("c"),
			{ type: "text", text: "Answer" },
			tool("d"),
		])

		expect(groups).toEqual([
			{ kind: "tools", parts: [tool("a"), tool("b"), tool("c")], groupKey: "a" },
			{ kind: "text", part: { type: "text", text: "Answer" }, index: 5 },
			{ kind: "tool", part: tool("d"), groupKey: "d" },
		])
	})
})
