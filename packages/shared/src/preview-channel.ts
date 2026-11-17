import type { WidgetAppearance, WidgetAppearanceInput } from "./widget-appearance"

const PREVIEW_CHANNEL_SOURCE = "talqo-preview"
export const PREVIEW_CHANNEL_VERSION = 1

export type PreviewReadyMessage = {
	source: typeof PREVIEW_CHANNEL_SOURCE
	type: "ready"
	version: number
}

export type PreviewConfigMessage = {
	appearance: WidgetAppearance
	title?: string
	forcedScheme?: "light" | "dark"
	isAvailable?: boolean
	source: typeof PREVIEW_CHANNEL_SOURCE
	type: "config"
	version: number
}

export type PreviewConfig = {
	appearance: WidgetAppearanceInput
	title?: string
	forcedScheme?: "light" | "dark"
	isAvailable?: boolean
}

export function configMessage(
	appearance: WidgetAppearance,
	options: { title?: string; forcedScheme?: "light" | "dark"; isAvailable?: boolean } = {},
): PreviewConfigMessage {
	return {
		source: PREVIEW_CHANNEL_SOURCE,
		version: PREVIEW_CHANNEL_VERSION,
		type: "config",
		appearance,
		title: options.title,
		forcedScheme: options.forcedScheme,
		isAvailable: options.isAvailable,
	}
}

function previewEnvelope(data: unknown, type: "ready" | "config"): Record<string, unknown> | undefined {
	if (typeof data !== "object" || data === null) return undefined
	const message = data as Record<string, unknown>
	return message.source === PREVIEW_CHANNEL_SOURCE &&
		message.version === PREVIEW_CHANNEL_VERSION &&
		message.type === type
		? message
		: undefined
}

export function isReadyMessage(data: unknown): data is PreviewReadyMessage {
	return previewEnvelope(data, "ready") !== undefined
}

export function readyMessage(): PreviewReadyMessage {
	return { source: PREVIEW_CHANNEL_SOURCE, version: PREVIEW_CHANNEL_VERSION, type: "ready" }
}

export function trustedParentOrigin(value: string | null): string | undefined {
	if (!value) return undefined
	try {
		return new URL(value).origin === value ? value : undefined
	} catch {
		return undefined
	}
}

function previewOptions(message: Record<string, unknown>): Omit<PreviewConfig, "appearance"> {
	return {
		title: typeof message.title === "string" ? message.title : undefined,
		forcedScheme:
			message.forcedScheme === "light" || message.forcedScheme === "dark" ? message.forcedScheme : undefined,
		isAvailable: typeof message.isAvailable === "boolean" ? message.isAvailable : undefined,
	}
}

export function configFromMessage(data: unknown): PreviewConfig | undefined {
	const message = previewEnvelope(data, "config")
	if (
		message === undefined ||
		typeof message.appearance !== "object" ||
		message.appearance === null ||
		Array.isArray(message.appearance)
	) {
		return undefined
	}
	return {
		appearance: message.appearance,
		...previewOptions(message),
	}
}
