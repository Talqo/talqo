const MILLISECONDS_PER_DAY = 86_400_000
const RECENT_DAYS = 2

function localMidnight(date: Date): number {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

export function formatDateTime(value: string, language: string): string {
	return new Date(value).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" })
}

export function formatTime(value: string, language: string): string {
	return new Date(value).toLocaleTimeString(language, { timeStyle: "short" })
}

export function formatDay(value: string, language: string, now = new Date()): string {
	const date = new Date(value)
	const daysAgo = Math.round((localMidnight(now) - localMidnight(date)) / MILLISECONDS_PER_DAY)
	if (daysAgo >= 0 && daysAgo < RECENT_DAYS) {
		return new Intl.RelativeTimeFormat(language, { numeric: "auto" }).format(-daysAgo, "day")
	}
	return date.toLocaleDateString(language, { dateStyle: "full" })
}
