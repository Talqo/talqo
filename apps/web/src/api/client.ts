import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

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
	ownerId: string | null
	status: "active" | "paused"
	systemPrompt: string
	wordBlacklist: string[]
}

export type AgentInput = {
	name?: string
	status?: Agent["status"]
	systemPrompt?: string
	wordBlacklist?: string[]
}

export function listAgents(signal?: AbortSignal): Promise<{ agents: Agent[] }> {
	return request("/api/agents", { signal })
}

export function getAgent(id: string, signal?: AbortSignal): Promise<{ agent: Agent }> {
	return request(`/api/agents/${encodeURIComponent(id)}`, { signal })
}

export function createAgent(input: AgentInput & { name: string }): Promise<{ agent: Agent }> {
	return request("/api/agents", { method: "POST", body: JSON.stringify(input) })
}

export function updateAgent(id: string, input: AgentInput): Promise<{ agent: Agent }> {
	return request(`/api/agents/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })
}

export function deleteAgent(id: string): Promise<void> {
	return request(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" })
}

export type Widget = {
	id: string
	agentId: string
	name: string
	publicToken: string
	appearance: WidgetAppearance
}

export type WidgetInput = {
	agentId?: string
	name?: string
	appearance?: WidgetAppearance
}

export function listWidgets(signal?: AbortSignal): Promise<{ widgets: Widget[] }> {
	return request("/api/widgets", { signal })
}

export function getWidget(id: string, signal?: AbortSignal): Promise<{ widget: Widget }> {
	return request(`/api/widgets/${encodeURIComponent(id)}`, { signal })
}

export function createWidget(input: WidgetInput & { agentId: string; name: string }): Promise<{ widget: Widget }> {
	return request("/api/widgets", { method: "POST", body: JSON.stringify(input) })
}

export function updateWidget(id: string, input: WidgetInput): Promise<{ widget: Widget }> {
	return request(`/api/widgets/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) })
}

export function deleteWidget(id: string): Promise<void> {
	return request(`/api/widgets/${encodeURIComponent(id)}`, { method: "DELETE" })
}
