import type { WidgetAppearanceInput } from "@talqo/shared/widget-appearance"

/**
 * Widget side of the preview channel; the dashboard declares the same shape in
 * `apps/web/src/features/widgets/preview-channel.ts`. Apps never import each other.
 */
export const PREVIEW_CHANNEL_SOURCE = "talqo-preview"
export const PREVIEW_CHANNEL_VERSION = 1

export type PreviewReadyMessage = {
	source: typeof PREVIEW_CHANNEL_SOURCE
	type: "ready"
	version: number
}

export type PreviewConfig = {
	appearance: WidgetAppearanceInput
	title?: string
	/** Pins the widget to whichever Light/Dark tab the operator is editing. */
	forcedScheme?: "light" | "dark"
}

export function readyMessage(): PreviewReadyMessage {
	return { source: PREVIEW_CHANNEL_SOURCE, version: PREVIEW_CHANNEL_VERSION, type: "ready" }
}

/** Concrete origins only: the parent comes from the URL, and `"*"` would broadcast the handshake. */
export function trustedParentOrigin(value: string | null): string | undefined {
	if (!value) {
		return undefined
	}
	try {
		return new URL(value).origin === value ? value : undefined
	} catch {
		return undefined
	}
}

/** Undefined for foreign or version-mismatched messages, degrading to the URL-param initial paint. */
export function configFromMessage(data: unknown): PreviewConfig | undefined {
	if (typeof data !== "object" || data === null) {
		return undefined
	}
	const message = data as {
		appearance?: unknown
		forcedScheme?: unknown
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
	}
}
