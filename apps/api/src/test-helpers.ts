export const DEFAULT_PASSWORD = "correct-horse-battery-staple"

export function uniqueUsername(): string {
	return `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
}
