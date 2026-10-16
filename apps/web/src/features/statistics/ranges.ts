const STATS_DAYS_WEEK = 7
const STATS_DAYS_MONTH = 30
const STATS_DAYS_HALF_YEAR = 183
const STATS_DAYS_YEAR = 365

// The time range rides in the ?days= search param next to ?agents= so a filtered dashboard
// stays shareable; anything outside the presets falls back to the default.
export const STATS_RANGE_PRESETS = [
	STATS_DAYS_WEEK,
	STATS_DAYS_MONTH,
	STATS_DAYS_HALF_YEAR,
	STATS_DAYS_YEAR,
	"all",
] as const
export type StatsDays = (typeof STATS_RANGE_PRESETS)[number]

export const DEFAULT_STATS_DAYS: StatsDays = 30

export function parseDaysParam(value: unknown): StatsDays | undefined {
	const coerced = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value
	return STATS_RANGE_PRESETS.find((preset) => preset === coerced)
}
