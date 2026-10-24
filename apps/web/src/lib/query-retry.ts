const CLIENT_ERROR_MIN = 400
const SERVER_ERROR_MIN = 500
const RETRY_LIMIT = 3

export function retryUnlessClientError(failureCount: number, error: { status?: number }): boolean {
	if (error.status && error.status >= CLIENT_ERROR_MIN && error.status < SERVER_ERROR_MIN) return false
	return failureCount < RETRY_LIMIT
}
