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
	// Orval fetch errors expose the status and parsed error body as `info.error`.
	const response = (error as { info?: { error?: string }; status?: number } | null) ?? {}
	if (response.status === FORBIDDEN_STATUS) return messages.permissionDenied
	return response.info?.error ?? messages.fallback
}
