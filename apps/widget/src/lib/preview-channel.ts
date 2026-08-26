import type { WidgetAppearanceInput } from "@talqo/shared/widget-appearance"

/**
 * Widget side of the dashboard preview channel; the dashboard declares the same
 * shape in `apps/web/src/features/widgets/preview-channel.ts`. Apps never import each
 * other, so the wire format is the contract and `PREVIEW_CHANNEL_VERSION` guards it.
 */
export const PREVIEW_CHANNEL_SOURCE = "talqo-preview"
export const PREVIEW_CHANNEL_VERSION = 1

export type PreviewReadyMessage = {
	source: typeof PREVIEW_CHANNEL_SOURCE
	type: "ready"
	version: number
}

export function readyMessage(): PreviewReadyMessage {
	return { source: PREVIEW_CHANNEL_SOURCE, version: PREVIEW_CHANNEL_VERSION, type: "ready" }
}

/**
 * Returns the appearance carried by a config message, or undefined for anything
 * else on the window -- another embed's chatter, or a preview page cached from an
 * older deploy. Ignoring a version mismatch degrades to the URL-param initial paint.
 */
export function configFromMessage(data: unknown): WidgetAppearanceInput | undefined {
	if (typeof data !== "object" || data === null) {
		return undefined
	}
	const message = data as { appearance?: unknown; source?: unknown; type?: unknown; version?: unknown }
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
	return message.appearance as WidgetAppearanceInput
}
