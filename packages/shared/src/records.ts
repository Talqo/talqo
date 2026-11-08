export function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
	const leftEntries = Object.entries(left).toSorted(([a], [b]) => a.localeCompare(b))
	const rightEntries = Object.entries(right).toSorted(([a], [b]) => a.localeCompare(b))
	return JSON.stringify(leftEntries) === JSON.stringify(rightEntries)
}
