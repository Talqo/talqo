import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

const NO_CONTENT_STATUS = 204

/**
 * Hand-written rather than generated: the widget endpoints are not in the OpenAPI
 * contract yet, so orval produces no client for them (see apps/api openapi:generate).
 */
export class WidgetApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message)
	}
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
		// Only declared when a body exists: the API rejects a JSON content type whose body
		// it cannot parse, which a bodyless GET or DELETE would otherwise trigger.
		headers: { ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }), ...init?.headers },
	})

	if (response.status === NO_CONTENT_STATUS) return undefined as T

	const body: unknown = await response.json().catch(() => undefined)

	if (!response.ok) {
		throw new WidgetApiError(response.status, isErrorBody(body) ? body.error : response.statusText)
	}

	return body as T
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
