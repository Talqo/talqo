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

	function consume(key: string, limit: number): void {
		const count = counters.get(key) ?? 0
		if (count >= limit) throw new CredentialRateLimitError(Math.max(1, Math.ceil((expiresAt - Date.now()) / SECOND_MS)))
		counters.set(key, count + 1)
	}

	return async (network, username, operation) => {
		if (active >= MAX_CREDENTIAL_OPERATIONS) throw new CredentialRateLimitError(1)
		const now = Date.now()
		if (now >= expiresAt) {
			counters.clear()
			expiresAt = (Math.floor(now / WINDOW_MS) + 1) * WINDOW_MS
		}
		// The global check comes first, bounding this map to 601 keys per window.
		consume("global", GLOBAL_LIMIT)
		if (network) consume(`network:${network}`, NETWORK_LIMIT)
		consume(`username:${username.toLowerCase()}`, USERNAME_LIMIT)
		active += 1
		try {
			return await operation()
		} finally {
			active -= 1
		}
	}
}
