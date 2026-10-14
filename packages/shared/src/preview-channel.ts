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

export function isReadyMessage(data: unknown): data is PreviewReadyMessage {
	if (typeof data !== "object" || data === null) return false
	const message = data as Partial<PreviewReadyMessage>
	return (
		message.source === PREVIEW_CHANNEL_SOURCE && message.version === PREVIEW_CHANNEL_VERSION && message.type === "ready"
	)
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

export function configFromMessage(data: unknown): PreviewConfig | undefined {
	if (typeof data !== "object" || data === null) return undefined
	const message = data as {
		appearance?: unknown
		forcedScheme?: unknown
		isAvailable?: unknown
		source?: unknown
		title?: unknown
		type?: unknown
		version?: unknown
	}
	if (
		message.source !== PREVIEW_CHANNEL_SOURCE ||
		message.version !== PREVIEW_CHANNEL_VERSION ||
		message.type !== "config" ||
		typeof message.appearance !== "object" ||
		message.appearance === null ||
		Array.isArray(message.appearance)
	) {
		return undefined
	}
	return {
		appearance: message.appearance as WidgetAppearanceInput,
		title: typeof message.title === "string" ? message.title : undefined,
		forcedScheme:
			message.forcedScheme === "light" || message.forcedScheme === "dark" ? message.forcedScheme : undefined,
		isAvailable: typeof message.isAvailable === "boolean" ? message.isAvailable : undefined,
	}
}
