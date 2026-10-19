const MILLISECONDS_PER_DAY = 86_400_000
const RECENT_DAYS = 2

function localMidnight(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

// Today and yesterday read as words; older days show the full date.
export function conversationDay(value: string, language: string, now = new Date()): string {
	const date = new Date(value)
	const daysAgo = Math.round((localMidnight(now) - localMidnight(date)) / MILLISECONDS_PER_DAY)
	if (daysAgo >= 0 && daysAgo < RECENT_DAYS) {
		return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-daysAgo, "day")
	}
	return date.toLocaleDateString(language, { dateStyle: "full" })
}

export function formatConversationTime(value: string, language: string): string {
	return new Date(value).toLocaleTimeString(language, { timeStyle: "short" })
}

export function formatConversationDate(value: string, language: string): string {
	return new Date(value).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" })
}
