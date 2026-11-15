import { describe, expect, it } from "bun:test"

import { planRows, transcriptRows } from "./conversation.seed.ts"

const NOON = new Date("2026-05-15T12:00:00.000Z")
const JUST_AFTER_MIDNIGHT = new Date("2026-05-15T00:01:00.000Z")
const AGENT_IDS = [
	"11111111-1111-4111-8111-111111111111",
	"33333333-3333-4333-8333-333333333333",
	"44444444-4444-4444-8444-444444444444",
] as const

function countBy(items: { agentId: string }[]): Record<string, number> {
	return items.reduce<Record<string, number>>((counts, item) => {
		counts[item.agentId] = (counts[item.agentId] ?? 0) + 1
		return counts
	}, {})
}

describe("conversation seed traffic", () => {
	it("plans a full month of per-agent traffic plus two recent conversations", () => {
		const rows = planRows(NOON)

		expect(rows.conversations).toHaveLength(362)
		expect(rows.attempts).toHaveLength(362)
		expect(rows.messages).toHaveLength(1_448)
		expect(rows.usages).toHaveLength(362)
		expect(countBy(rows.conversations)).toEqual({
			[AGENT_IDS[0]]: 181,
			[AGENT_IDS[1]]: 121,
			[AGENT_IDS[2]]: 60,
		})
		expect(new Set(rows.conversations.map((row) => row.id)).size).toBe(rows.conversations.length)
		for (const conversation of rows.conversations) expect(conversation.id).toStartWith("seed-stats-")
		for (const message of rows.messages) expect(message.createdAt.getTime()).toBeLessThanOrEqual(NOON.getTime())
		for (const attempt of rows.attempts) {
			expect(attempt).toMatchObject({
				finalOutcome: "completed",
				providerInvoked: true,
				status: "completed",
				usageInputTokens: 1_280,
				usageOutputTokens: 320,
			})
		}
	})

	it("skips today's traffic when the elapsed day cannot fit a whole conversation", () => {
		const rows = planRows(JUST_AFTER_MIDNIGHT)

		expect(rows.conversations).toHaveLength(350)
		for (const conversation of rows.conversations) {
			expect(conversation.createdAt.getTime()).toBeLessThan(new Date("2026-05-15T00:00:00Z").getTime())
		}
		for (const message of rows.messages) {
			expect(message.createdAt.getTime()).toBeLessThanOrEqual(JUST_AFTER_MIDNIGHT.getTime())
		}
	})

	it("links each planned attempt to the last message of its conversation", () => {
		const rows = planRows(NOON)
		const messagesByConversation = new Map<string, typeof rows.messages>()
		for (const message of rows.messages) {
			const stored = messagesByConversation.get(message.conversationId) ?? []
			stored.push(message)
			messagesByConversation.set(message.conversationId, stored)
		}

		for (const attempt of rows.attempts) {
			const messages = messagesByConversation.get(attempt.conversationId) ?? []
			expect(messages).toHaveLength(4)
			expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"])
			expect(messages.at(-1)?.createdAt).toEqual(attempt.usageRecordedAt)
		}
	})
})

describe("conversation seed transcripts", () => {
	it("plans stable transcripts whose revisions follow their completed turns", () => {
		const rows = transcriptRows(NOON.getTime())

		expect(rows.conversations).toHaveLength(7)
		expect(rows.attempts).toHaveLength(8)
		expect(rows.messages).toHaveLength(16)
		expect(rows.conversations.map((conversation) => conversation.revision)).toEqual([2, 1, 1, 0, 0, 0, 0])
		expect(rows.conversations.map((conversation) => conversation.latestCompletedMessageId === null)).toEqual([
			false,
			false,
			false,
			true,
			true,
			true,
			true,
		])
		expect(rows.attempts.map((attempt) => attempt.finalOutcome)).toEqual([
			"completed",
			"completed",
			"completed",
			"completed",
			"blocked",
			"failed",
			"interrupted",
			"cancelled",
		])
		for (const attempt of rows.attempts) {
			expect(attempt).toMatchObject({ providerInvoked: true, usageInputTokens: 200, usageOutputTokens: 200 })
		}
		expect(transcriptRows(NOON.getTime())).toEqual(rows)
	})
})
