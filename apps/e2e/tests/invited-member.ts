import { type APIRequestContext, expect } from "@playwright/test"

import { ADMIN } from "./log-in"

export async function createInvitedMember(
	request: APIRequestContext,
	account: { username: string; password: string },
): Promise<void> {
	await expect(await request.post("/api/auth/login", { data: ADMIN })).toBeOK()
	const invitation = await request.post("/api/invitations")
	await expect(invitation).toBeOK()
	const body: unknown = await invitation.json()
	if (!body || typeof body !== "object" || !("token" in body) || typeof body.token !== "string") {
		throw new Error("Invitation response is missing its token")
	}
	await expect(await request.post("/api/invitations/redeem", { data: { ...account, token: body.token } })).toBeOK()
}
