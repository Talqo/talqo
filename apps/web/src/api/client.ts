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
	// FormData bodies must not get a Content-Type header: the browser sets it with the boundary.
	const headers =
		init?.body instanceof FormData ? init?.headers : { "Content-Type": "application/json", ...init?.headers }
	const response = await fetch(path, { ...init, credentials: "include", headers })

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

export function logout(): Promise<void> {
	return request("/api/auth/logout", { method: "POST" })
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

export type Agent = {
	id: string
	name: string
	status: "active" | "paused"
	systemPrompt: string
	wordBlacklist: string[]
	avatarUrl: string | null
}

export type AgentFile = {
	id: string
	name: string
	mimeType: string
	sizeBytes: number
	createdAt: string
}

export function getAgents(signal?: AbortSignal): Promise<{ agents: Agent[] }> {
	return request("/api/agents", { signal })
}

export function getAgent(id: string, signal?: AbortSignal): Promise<{ agent: Agent }> {
	return request(`/api/agents/${id}`, { signal })
}

export function createAgent(input: { name: string }): Promise<{ agent: Agent }> {
	return request("/api/agents", { method: "POST", body: JSON.stringify(input) })
}

export function updateAgent(
	id: string,
	patch: Partial<{ active: boolean; name: string; systemPrompt: string; wordBlacklist: string[] }>,
): Promise<{ agent: Agent }> {
	return request(`/api/agents/${id}`, { method: "PATCH", body: JSON.stringify(patch) })
}

export function deleteAgent(id: string): Promise<void> {
	return request(`/api/agents/${id}`, { method: "DELETE" })
}

export type AgentFilesResponse = {
	files: AgentFile[]
	maxNameLength: number
	maxSizeBytes: number
}

export function getAgentFiles(agentId: string, signal?: AbortSignal): Promise<AgentFilesResponse> {
	return request(`/api/agents/${agentId}/files`, { signal })
}

export function uploadAgentFile(agentId: string, file: File): Promise<{ file: AgentFile }> {
	const form = new FormData()
	form.append("file", file)
	return request(`/api/agents/${agentId}/files`, { method: "POST", body: form })
}

export function deleteAgentFile(agentId: string, fileId: string): Promise<void> {
	return request(`/api/agents/${agentId}/files/${fileId}`, { method: "DELETE" })
}

export function renameAgentFile(agentId: string, fileId: string, name: string): Promise<{ file: AgentFile }> {
	return request(`/api/agents/${agentId}/files/${fileId}`, { method: "PATCH", body: JSON.stringify({ name }) })
}
