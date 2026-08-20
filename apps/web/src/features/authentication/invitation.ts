import { normalizeApiError } from "@/api/errors.ts"

const FORBIDDEN_STATUS = 403

export function buildInvitationUrl(origin: string, token: string): string {
	const url = new URL("/accept-invite", origin)
	url.searchParams.set("token", token)
	return url.toString()
}

export function formatInvitationExpiry(expiresAt: string, language: string, timeZone?: string): string {
	return new Intl.DateTimeFormat(language, {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone,
	}).format(new Date(expiresAt))
}

export function getInvitationErrorMessage(
	error: unknown,
	messages: { fallback: string; permissionDenied: string },
): string {
	const apiError = normalizeApiError(error)
	if (!apiError) return messages.fallback
	return apiError.status === FORBIDDEN_STATUS ? messages.permissionDenied : apiError.message
}
