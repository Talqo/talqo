import { QueryClient } from "@tanstack/react-query"
import { describe, expect, test } from "bun:test"

import { clearAgentContent } from "./clear-agent-content"

describe("clearAgentContent", () => {
	test("removes every protected agent, embed, conversation, and statistics query", () => {
		const client = new QueryClient()
		const protectedKeys = [
			["/api/agents/agent-1"],
			["/api/agents/agent-1/files"],
			["/api/embeds"],
			["/api/embeds/embed-1"],
			["/api/conversations"],
			["/api/conversations/conversation-1"],
			["/api/stats", { days: 7 }],
		]
		for (const key of protectedKeys) client.setQueryData(key, { private: true })

		clearAgentContent(client)

		for (const key of protectedKeys) expect(client.getQueryData(key)).toBeUndefined()
	})

	test("keeps unrelated and non-path cache entries", () => {
		const client = new QueryClient()
		const keptKeys = [
			["/api/me/permissions"],
			["/api/agentsx"],
			["/api/embedsx"],
			["/api/statsx"],
			[42, "private"],
			[{ scope: "private" }],
		]
		for (const key of keptKeys) client.setQueryData(key, { private: true })

		clearAgentContent(client)

		for (const key of keptKeys) expect(client.getQueryData(key)).toEqual({ private: true })
	})
})
