export function sameStringRecord(left: Record<string, string>, right: Record<string, string>): boolean {
	const leftKeys = Object.keys(left)
	if (leftKeys.length !== Object.keys(right).length) return false
	return leftKeys.every((key) => Object.hasOwn(right, key) && left[key] === right[key])
}
