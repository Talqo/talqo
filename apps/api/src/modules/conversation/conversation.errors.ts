import { ApiError, PROBLEM_CODES } from "@/http/problem.ts"
import { HTTP_STATUS } from "@/http/status.ts"

export class SessionUnauthorizedError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.CHAT_SESSION_UNAUTHORIZED, HTTP_STATUS.UNAUTHORIZED, message, undefined, options)
	}
}
export class EmbedDisabledError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.EMBED_DISABLED, HTTP_STATUS.FORBIDDEN, message, undefined, options)
	}
}
export class RequestConflictError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.CHAT_REQUEST_CONFLICT, HTTP_STATUS.CONFLICT, message, undefined, options)
	}
}
export class ConversationTooLongError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.CHAT_CONVERSATION_TOO_LONG, HTTP_STATUS.BAD_REQUEST, message, undefined, options)
	}
}

const UTC_RESET_HOUR = 24
const MILLISECONDS_PER_SECOND = 1000

function dailyAllowanceHeaders(): Record<string, string> {
	const reset = new Date()
	reset.setUTCHours(UTC_RESET_HOUR, 0, 0, 0)
	return {
		"Retry-After": String(Math.max(1, Math.ceil((reset.getTime() - Date.now()) / MILLISECONDS_PER_SECOND))),
		"X-RateLimit-Reset": reset.toISOString(),
	}
}

export class DailyAllowanceExceededError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(
			PROBLEM_CODES.CHAT_DAILY_ALLOWANCE_EXCEEDED,
			HTTP_STATUS.TOO_MANY_REQUESTS,
			message,
			dailyAllowanceHeaders(),
			options,
		)
	}
}
export class ConcurrentGenerationLimitError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.CHAT_CONCURRENCY_LIMIT, HTTP_STATUS.TOO_MANY_REQUESTS, message, { "Retry-After": "1" }, options)
	}
}
export class SessionBusyError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.CHAT_SESSION_BUSY, HTTP_STATUS.TOO_MANY_REQUESTS, message, { "Retry-After": "1" }, options)
	}
}
export class InvalidChatInputError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.INVALID_REQUEST, HTTP_STATUS.BAD_REQUEST, message, undefined, options)
	}
}
export class ProviderUnavailableError extends ApiError {
	constructor(message?: string, options?: ErrorOptions) {
		super(PROBLEM_CODES.PROVIDER_ERROR, HTTP_STATUS.BAD_GATEWAY, message, undefined, options)
	}
}
