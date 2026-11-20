import { describe, expect, it } from "bun:test"

import type { MessagePart } from "./conversation.messages.ts"

import { planRows, transcriptRows } from "./conversation.seed.ts"

const NOON = new Date("2026-05-15T12:00:00.000Z")
const JUST_AFTER_MIDNIGHT = new Date("2026-05-15T00:01:00.000Z")
const AGENT_IDS = [
	"11111111-1111-4111-8111-111111111111",
	"33333333-3333-4333-8333-333333333333",
	"44444444-4444-4444-8444-444444444444",
] as const

type ToolPart = Extract<MessagePart, { type: "dynamic-tool" }>

function isToolPart(part: MessagePart): part is ToolPart {
	return part.type === "dynamic-tool"
}

function countBy(items: { agentId: string }[]): Record<string, number> {
	return items.reduce<Record<string, number>>((counts, item) => {
		counts[item.agentId] = (counts[item.agentId] ?? 0) + 1
		return counts
	}, {})
}

function expectBothToolSources(tools: readonly ToolPart[]): void {
	expect(tools.some((part) => part.toolMetadata.source === "client")).toBe(true)
	expect(tools.some((part) => part.toolMetadata.source === "mcp")).toBe(true)
}

function toolsOf(messages: readonly { parts?: MessagePart[] }[]): ToolPart[] {
	return messages.flatMap((message) => (message.parts ?? []).filter(isToolPart))
}

function messagesByAttempt<T extends { generationAttemptId: string }>(messages: readonly T[]) {
	const grouped = new Map<string, T[]>()
	for (const message of messages) {
		const stored = grouped.get(message.generationAttemptId) ?? []
		stored.push(message)
		grouped.set(message.generationAttemptId, stored)
	}
	return grouped
}

describe("conversation seed traffic", () => {
	it("plans a month of varied per-agent traffic with one attempt per turn", () => {
		const rows = planRows(NOON)

		expect(rows.conversations.length).toBeGreaterThan(300)
		expect(rows.attempts).toHaveLength(rows.usages.length)
		expect(rows.messages).toHaveLength(rows.attempts.length * 2)
		const byAgent = countBy(rows.conversations)
		for (const agentId of AGENT_IDS) expect(byAgent[agentId] ?? 0).toBeGreaterThan(30)
		expect(new Set(rows.conversations.map((row) => row.id)).size).toBe(rows.conversations.length)
		expect(rows.conversations.every((conversation) => conversation.id.startsWith("seed-stats-"))).toBe(true)
		expect(rows.messages.every((message) => message.createdAt.getTime() <= NOON.getTime())).toBe(true)
		expect(rows.attempts.every((attempt) => attempt.providerInvoked === true && attempt.status === "completed")).toBe(
			true,
		)
		expect(rows.attempts.every((attempt) => attempt.finalOutcome === "completed")).toBe(true)
		expect(rows.usages.every((usage) => usage.outcome === "completed")).toBe(true)
		expect(
			rows.usages.every(
				(usage) => usage.inputTokens > 0 && usage.outputTokens > 0 && usage.createdAt.getTime() <= NOON.getTime(),
			),
		).toBe(true)

		const messages = messagesByAttempt(rows.messages)
		const attemptsByConversation = new Map<string, number>()
		for (const attempt of rows.attempts) {
			attemptsByConversation.set(attempt.conversationId, (attemptsByConversation.get(attempt.conversationId) ?? 0) + 1)
			const pair = messages.get(attempt.id) ?? []
			expect(pair.map((message) => message.role)).toEqual(["user", "assistant"])
			expect(pair.every((message) => message.outcome === "completed")).toBe(true)
			expect(pair[0]?.createdAt.getTime()).toBeLessThan(pair[1]?.createdAt.getTime() ?? 0)
		}
		for (const conversation of rows.conversations) {
			expect(conversation.revision).toBe(attemptsByConversation.get(conversation.id) ?? 0)
			expect(conversation.latestCompletedMessageId).not.toBeNull()
		}
		for (const usage of rows.usages) {
			const attempt = rows.attempts.find((row) => row.id === usage.generationAttemptId)
			expect(attempt).toMatchObject({
				conversationId: usage.conversationId,
				usageInputTokens: usage.inputTokens,
				usageOutputTokens: usage.outputTokens,
				usageRecordedAt: usage.createdAt,
			})
		}
	})

	it("varies daily volume so dashboard charts are not flat", () => {
		const rows = planRows(NOON)
		const dailyByAgent = new Map<string, Map<string, number>>()
		for (const conversation of rows.conversations) {
			const date = conversation.createdAt.toISOString().slice(0, 10)
			const daily = dailyByAgent.get(conversation.agentId) ?? new Map<string, number>()
			daily.set(date, (daily.get(date) ?? 0) + 1)
			dailyByAgent.set(conversation.agentId, daily)
		}

		expect(dailyByAgent.size).toBe(AGENT_IDS.length)
		for (const daily of dailyByAgent.values()) {
			const counts = [...daily.values()]
			expect(counts.length).toBeGreaterThanOrEqual(29)
			expect(new Set(counts).size).toBeGreaterThanOrEqual(3)
		}
		const dailyTotals = new Map<string, number>()
		for (const conversation of rows.conversations) {
			const date = conversation.createdAt.toISOString().slice(0, 10)
			dailyTotals.set(date, (dailyTotals.get(date) ?? 0) + 1)
		}
		expect(new Set(dailyTotals.values()).size).toBeGreaterThanOrEqual(5)
	})

	it("cuts traffic off at the current time", () => {
		const rows = planRows(JUST_AFTER_MIDNIGHT)
		const midnightRows = planRows(NOON)

		expect(rows.conversations.length).toBeLessThan(midnightRows.conversations.length)
		expect(
			rows.conversations.every((conversation) => conversation.createdAt.getTime() <= JUST_AFTER_MIDNIGHT.getTime()),
		).toBe(true)
		expect(rows.messages.every((message) => message.createdAt.getTime() <= JUST_AFTER_MIDNIGHT.getTime())).toBe(true)
		expect(rows.attempts.every((attempt) => attempt.usageRecordedAt.getTime() <= JUST_AFTER_MIDNIGHT.getTime())).toBe(
			true,
		)
	})

	it("includes website and backend tool calls in assistant messages", () => {
		const rows = planRows(NOON)
		const tools = toolsOf(rows.messages)

		expectBothToolSources(tools)
		expect(tools.every((part) => part.toolMetadata.displayName.length > 0)).toBe(true)
		expect(tools.every((part) => part.toolCallId.length > 0)).toBe(true)
		expect(tools.every((part) => part.state === "input-available" || part.state === "output-available")).toBe(true)
		expect(new Set(tools.map((part) => part.toolCallId)).size).toBe(tools.length)
	})
})

describe("conversation seed transcripts", () => {
	it("plans stable transcripts whose revisions follow their completed turns", () => {
		const rows = transcriptRows(NOON.getTime())

		expect(rows.conversations).toHaveLength(8)
		expect(rows.attempts).toHaveLength(11)
		expect(rows.messages).toHaveLength(22)
		expect(rows.usages).toHaveLength(11)
		expect(rows.conversations.map((conversation) => conversation.revision)).toEqual([2, 1, 1, 0, 0, 0, 0, 3])
		expect(rows.conversations.map((conversation) => conversation.latestCompletedMessageId === null)).toEqual([
			false,
			false,
			false,
			true,
			true,
			true,
			true,
			false,
		])
		expect(new Set(rows.attempts.map((attempt) => attempt.finalOutcome))).toEqual(
			new Set(["completed", "blocked", "failed", "interrupted", "cancelled"]),
		)
		for (const usage of rows.usages) {
			const attempt = rows.attempts.find((row) => row.id === usage.generationAttemptId)
			expect(attempt).toMatchObject({
				finalOutcome: usage.outcome,
				usageInputTokens: usage.inputTokens,
				usageOutputTokens: usage.outputTokens,
				usageRecordedAt: usage.createdAt,
			})
			expect(usage.inputTokens).toBeGreaterThan(0)
			expect(usage.outputTokens).toBeGreaterThanOrEqual(0)
		}
		const messages = messagesByAttempt(rows.messages)
		for (const attempt of rows.attempts) {
			const pair = messages.get(attempt.id) ?? []
			expect(pair.map((message) => message.role)).toEqual(["user", "assistant"])
			expect(pair[1]?.outcome).toBe(attempt.finalOutcome ?? undefined)
		}
		const failedAttempt = rows.attempts.find((attempt) => attempt.finalOutcome === "failed")
		if (!failedAttempt) throw new Error("Failed transcript attempt was not seeded")
		expect(messages.get(failedAttempt.id)?.[1]?.parts).toEqual([])
		expect(transcriptRows(NOON.getTime())).toEqual(rows)
	})

	it("covers completed, failed and interrupted tool calls", () => {
		const rows = transcriptRows(NOON.getTime())
		const tools = toolsOf(rows.messages)

		expectBothToolSources(tools)
		expect(tools.some((part) => part.toolMetadata.outcome === "completed")).toBe(true)
		expect(tools.some((part) => part.toolMetadata.outcome === "failed")).toBe(true)
		expect(tools.some((part) => part.toolMetadata.outcome === "interrupted")).toBe(true)
		expect(tools.filter((part) => part.state === "output-error")).toHaveLength(1)
		expect(tools.filter((part) => part.state === "input-available")).toHaveLength(1)
		expect(new Set(tools.map((part) => part.toolCallId)).size).toBe(tools.length)
	})
})
