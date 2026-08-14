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

const RANDOM_INCREMENT = 0x6d2b79f5
const RANDOM_SHIFT_A = 15
const RANDOM_SHIFT_B = 7
const RANDOM_MULTIPLIER = 61
const RANDOM_SHIFT_C = 14
const UINT32_RANGE = 4_294_967_296
const HASH_MULTIPLIER = 31
const DATE_PAD_LENGTH = 2
const HISTORY_DAYS = 30
const MIN_CONVERSATIONS = 10
const CONVERSATION_RANGE = 50
const MIN_MESSAGES = 50
const MESSAGE_RANGE = 200
const MIN_TOKENS = 2000
const TOKEN_RANGE = 10_000

function seededRandom(seed: number) {
	let state = seed
	return () => {
		state = (state + RANDOM_INCREMENT) | 0
		let t = Math.imul(state ^ (state >>> RANDOM_SHIFT_A), 1 | state)
		t = (t + Math.imul(t ^ (t >>> RANDOM_SHIFT_B), RANDOM_MULTIPLIER | t)) ^ t
		return ((t ^ (t >>> RANDOM_SHIFT_C)) >>> 0) / UINT32_RANGE
	}
}

function hashAgentId(agentId: string): number {
	let hash = 0
	for (let i = 0; i < agentId.length; i++) {
		hash = (Math.imul(hash, HASH_MULTIPLIER) + agentId.charCodeAt(i)) | 0
	}
	return hash
}

function formatLocalDate(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(DATE_PAD_LENGTH, "0")
	const day = String(date.getDate()).padStart(DATE_PAD_LENGTH, "0")
	return `${date.getFullYear()}-${month}-${day}`
}

function createMockStats(agentId: string): AgentStats {
	const random = seededRandom(hashAgentId(agentId))
	const history: AgentStats["history"] = []
	const today = new Date()

	for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
		const date = new Date(today)
		date.setDate(date.getDate() - i)
		history.push({
			date: formatLocalDate(date),
			conversations: Math.floor(random() * CONVERSATION_RANGE) + MIN_CONVERSATIONS,
			messages: Math.floor(random() * MESSAGE_RANGE) + MIN_MESSAGES,
			tokens: Math.floor(random() * TOKEN_RANGE) + MIN_TOKENS,
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
