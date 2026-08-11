import { useQuery } from "@tanstack/react-query"

export type AgentStats = {
	conversations: number
	messages: number
	tokens: number
	history: {
		date: string
		conversations: number
		messages: number
		tokens: number
	}[]
}

function seededRandom(seed: number) {
	let state = seed
	return () => {
		state = (state + 0x6d2b79f5) | 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function hashAgentId(agentId: string): number {
	let hash = 0
	for (let i = 0; i < agentId.length; i++) {
		hash = (Math.imul(hash, 31) + agentId.charCodeAt(i)) | 0
	}
	return hash
}

function formatLocalDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, "0")
	const day = String(date.getDate()).padStart(2, "0")
	return `${date.getFullYear()}-${month}-${day}`
}

function createMockStats(agentId: string): AgentStats {
	const random = seededRandom(hashAgentId(agentId))
	const history: AgentStats["history"] = []
	const today = new Date()

	for (let i = 29; i >= 0; i--) {
		const date = new Date(today)
		date.setDate(date.getDate() - i)
		history.push({
			date: formatLocalDate(date),
			conversations: Math.floor(random() * 50) + 10,
			messages: Math.floor(random() * 200) + 50,
			tokens: Math.floor(random() * 10000) + 2000,
		})
	}

	return {
		conversations: history.reduce((sum, day) => sum + day.conversations, 0),
		messages: history.reduce((sum, day) => sum + day.messages, 0),
		tokens: history.reduce((sum, day) => sum + day.tokens, 0),
		history,
	}
}

export function useAgentStats(agentId: string) {
	return useQuery({
		queryKey: ["agent-stats", agentId],
		queryFn: () => Promise.resolve(createMockStats(agentId)),
		enabled: agentId.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
	})
}
