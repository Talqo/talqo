import { describe, expect, test } from "bun:test"

import { toAgentDailyPoints, toSelectedStats, type StatsOverview } from "./page-stats"

function overview(overrides?: Partial<StatsOverview>): StatsOverview {
	return {
		days: 3,
		totals: { conversations: 4, messages: 8, inputTokens: 30, outputTokens: 15 },
		daily: [
			{ date: "2026-10-04", conversations: 1, messages: 2, inputTokens: 10, outputTokens: 5 },
			{ date: "2026-10-05", conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0 },
			{ date: "2026-10-06", conversations: 3, messages: 6, inputTokens: 20, outputTokens: 10 },
		],
		agentDaily: [
			{ date: "2026-10-04", conversations: 1, messages: 2, inputTokens: 10, outputTokens: 5, agentId: "a" },
			{ date: "2026-10-06", conversations: 2, messages: 4, inputTokens: 15, outputTokens: 8, agentId: "a" },
			{ date: "2026-10-06", conversations: 1, messages: 2, inputTokens: 5, outputTokens: 2, agentId: "b" },
		],
		agents: [
			{ agentId: "a", agentName: "Alpha", conversations: 3, messages: 6, inputTokens: 25, outputTokens: 13 },
			{ agentId: "b", agentName: "Beta", conversations: 1, messages: 2, inputTokens: 5, outputTokens: 2 },
		],
		active: [
			{ agentId: "a", conversations: 1 },
			{ agentId: "b", conversations: 1 },
		],
		activeWindowMinutes: 60,
		...overrides,
	}
}

describe("toAgentDailyPoints", () => {
	test("sums input and output tokens into one token metric", () => {
		const points = toAgentDailyPoints(overview())
		expect(points).toHaveLength(3)
		expect(points[0]).toEqual({
			agentId: "a",
			date: "2026-10-04",
			conversations: 1,
			messages: 2,
			tokens: 15,
		})
	})

	test("keeps duplicate agent-date rows so consumers can accumulate them", () => {
		const duplicated = overview({
			agentDaily: [
				{ date: "2026-10-06", conversations: 1, messages: 2, inputTokens: 5, outputTokens: 2, agentId: "a" },
				{ date: "2026-10-06", conversations: 1, messages: 2, inputTokens: 5, outputTokens: 2, agentId: "a" },
			],
		})
		expect(toAgentDailyPoints(duplicated)).toHaveLength(2)
	})
})

describe("toSelectedStats", () => {
	test("consumes the server totals and daily axis when all agents are selected", () => {
		const stats = toSelectedStats(overview(), ["a", "b"], true)
		expect(stats.conversations).toBe(4)
		expect(stats.messages).toBe(8)
		expect(stats.tokens).toBe(45)
		// The dense daily axis comes from the server, zero-activity days included, and its
		// endpoints match the window exactly (no off-by-one dropped day).
		expect(stats.daily).toEqual([
			{ date: "2026-10-04", conversations: 1, messages: 2, tokens: 15 },
			{ date: "2026-10-05", conversations: 0, messages: 0, tokens: 0 },
			{ date: "2026-10-06", conversations: 3, messages: 6, tokens: 30 },
		])
	})

	test("re-aggregates a subset from the sparse per-agent series, zero-filled per axis date", () => {
		const stats = toSelectedStats(overview(), ["b"], false)
		expect(stats.conversations).toBe(1)
		expect(stats.messages).toBe(2)
		expect(stats.tokens).toBe(7)
		expect(stats.daily).toEqual([
			{ date: "2026-10-04", conversations: 0, messages: 0, tokens: 0 },
			{ date: "2026-10-05", conversations: 0, messages: 0, tokens: 0 },
			{ date: "2026-10-06", conversations: 1, messages: 2, tokens: 7 },
		])
	})

	test("accumulates duplicate agent-date rows instead of keeping the last value", () => {
		const duplicated = overview({
			agentDaily: [
				{ date: "2026-10-06", conversations: 1, messages: 2, inputTokens: 5, outputTokens: 2, agentId: "a" },
				{ date: "2026-10-06", conversations: 1, messages: 2, inputTokens: 5, outputTokens: 2, agentId: "a" },
			],
		})
		const stats = toSelectedStats(duplicated, ["a"], false)
		expect(stats.conversations).toBe(2)
		expect(stats.daily[2]).toEqual({ date: "2026-10-06", conversations: 2, messages: 4, tokens: 14 })
	})

	test("ignores per-agent rows whose date falls outside the server's axis", () => {
		const stray = overview({
			agentDaily: [
				...overview().agentDaily,
				{ date: "2026-10-01", conversations: 9, messages: 9, inputTokens: 9, outputTokens: 9, agentId: "a" },
			],
		})
		const stats = toSelectedStats(stray, ["a"], false)
		expect(stats.conversations).toBe(3)
	})
})
