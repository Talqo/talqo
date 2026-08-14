import { ApiError } from "./errors.ts"

const NO_CONTENT_STATUS = 204

export type PublicUser = {
	id: string
	username: string
}

function isErrorBody(body: unknown): body is { error: string } {
	return (
		typeof body === "object" &&
		body !== null &&
		"error" in body &&
		typeof (body as { error: unknown }).error === "string"
	)
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, {
		...init,
		credentials: "include",
		headers: { "Content-Type": "application/json", ...init?.headers },
	})

	if (response.status === NO_CONTENT_STATUS) return undefined as T

	const body: unknown = await response.json().catch(() => undefined)

	if (!response.ok) {
		throw new ApiError(response.status, isErrorBody(body) ? body.error : response.statusText)
	}

	return body as T
}

export function getSetupStatus(signal?: AbortSignal): Promise<{ needsSetup: boolean }> {
	return request("/api/setup", { signal })
}

export function bootstrapAdmin(input: { password: string; username: string }): Promise<{ user: PublicUser }> {
	return request("/api/setup", { method: "POST", body: JSON.stringify(input) })
}

export function login(input: { password: string; username: string }): Promise<{ user: PublicUser }> {
	return request("/api/auth/login", { method: "POST", body: JSON.stringify(input) })
}

export function getSession(signal?: AbortSignal): Promise<{ user: PublicUser | null }> {
	return request("/api/auth/session", { signal })
}

export function createInvitation(): Promise<{ expiresAt: string; token: string }> {
	return request("/api/invitations", { method: "POST" })
}

export function redeemInvitation(input: {
	password: string
	token: string
	username: string
}): Promise<{ user: PublicUser }> {
	return request("/api/invitations/redeem", { method: "POST", body: JSON.stringify(input) })
}
