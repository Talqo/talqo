export function buildInvitationUrl(origin: string, token: string): string {
	const url = new URL("/accept-invite", origin)
	url.searchParams.set("token", token)
	return url.toString()
}
