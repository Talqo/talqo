import { ApiError, PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"

const WINDOW_MS = 60_000
const SECOND_MS = 1_000
const MAX_CREDENTIAL_OPERATIONS = 4
const GLOBAL_LIMIT = 300
const NETWORK_LIMIT = 30
const USERNAME_LIMIT = 10

type CredentialOperation = <T>(network: string | null, username: string, operation: () => Promise<T>) => Promise<T>

export class CredentialRateLimitError extends ApiError {
	constructor(retryAfterSeconds: number) {
		super(PROBLEM_CODES.AUTH_RATE_LIMITED, HTTP_STATUS.TOO_MANY_REQUESTS, undefined, {
			"Retry-After": String(retryAfterSeconds),
		})
	}
}

export function createCredentialLimiter(): CredentialOperation {
	const counters = new Map<string, number>()
	let expiresAt = 0
	let active = 0

	return async (network, username, operation) => {
		if (active >= MAX_CREDENTIAL_OPERATIONS) throw new CredentialRateLimitError(1)
		const now = Date.now()
		if (now >= expiresAt) {
			counters.clear()
			expiresAt = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS
		}
		const budgets: [string, number][] = [["global", GLOBAL_LIMIT]]
		if (network) budgets.push([`network:${network}`, NETWORK_LIMIT])
		budgets.push([`username:${username.toLowerCase()}`, USERNAME_LIMIT])
		for (const [key, limit] of budgets) {
			if ((counters.get(key) ?? 0) >= limit)
				throw new CredentialRateLimitError(Math.max(1, Math.ceil((expiresAt - now) / SECOND_MS)))
		}
		// Only accepted attempts add keys, bounding this map to 601 entries per window.
		for (const [key] of budgets) counters.set(key, (counters.get(key) ?? 0) + 1)
		active += 1
		try {
			return await operation()
		} finally {
			active -= 1
		}
	}
}
