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
