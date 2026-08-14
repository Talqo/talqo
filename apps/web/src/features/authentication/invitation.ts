import { ApiError } from "@/api/errors.ts"

const FORBIDDEN_STATUS = 403

export function buildInvitationUrl(origin: string, token: string): string {
	const url = new URL("/accept-invite", origin)
	url.searchParams.set("token", token)
	return url.toString()
}

export function getInvitationErrorMessage(
	error: unknown,
	messages: { fallback: string; permissionDenied: string },
): string {
	if (!(error instanceof ApiError)) return messages.fallback
	return error.status === FORBIDDEN_STATUS ? messages.permissionDenied : error.message
}
