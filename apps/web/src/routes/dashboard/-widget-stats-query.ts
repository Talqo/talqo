import { useQuery } from "@tanstack/react-query"

export type WidgetStats = {
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

// Seed stable mock stats per widget so refetches do not reshuffle the chart;
// replace with the /widgets/:id/stats endpoint when it exists.
function seededRandom(seed: number) {
	let state = seed
	return () => {
		state = (state + 0x6d2b79f5) | 0
		let t = Math.imul(state ^ (state >>> 15), 1 | state)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function hashWidgetId(widgetId: string): number {
	let hash = 0
	for (let i = 0; i < widgetId.length; i++) {
		hash = (Math.imul(hash, 31) + widgetId.charCodeAt(i)) | 0
	}
	return hash
}

function createMockStats(widgetId: string): WidgetStats {
	const random = seededRandom(hashWidgetId(widgetId))
	const history: WidgetStats["history"] = []
	const today = new Date()

	for (let i = 29; i >= 0; i--) {
		const date = new Date(today)
		date.setDate(date.getDate() - i)
		history.push({
			date: date.toISOString().slice(0, 10),
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

export function useWidgetStats(widgetId: string) {
	return useQuery({
		queryKey: ["widget-stats", widgetId],
		queryFn: () => Promise.resolve(createMockStats(widgetId)),
		enabled: widgetId.length > 0,
		staleTime: Number.POSITIVE_INFINITY,
	})
}
