import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

/**
 * Dashboard side of the preview channel; the widget declares the same shape in
 * `apps/widget/src/lib/preview-channel.ts`. Apps never import each other.
 */
export const PREVIEW_CHANNEL_SOURCE = "talqo-preview"
export const PREVIEW_CHANNEL_VERSION = 1

export type PreviewReadyMessage = {
	source: typeof PREVIEW_CHANNEL_SOURCE
	type: "ready"
	version: number
}

export type PreviewConfigMessage = {
	appearance: WidgetAppearance
	title?: string
	/** Pins the widget to whichever Light/Dark tab the operator is editing. */
	forcedScheme?: "light" | "dark"
	source: typeof PREVIEW_CHANNEL_SOURCE
	type: "config"
	version: number
}

export function configMessage(
	appearance: WidgetAppearance,
	options: { title?: string; forcedScheme?: "light" | "dark" } = {},
): PreviewConfigMessage {
	return {
		source: PREVIEW_CHANNEL_SOURCE,
		version: PREVIEW_CHANNEL_VERSION,
		type: "config",
		appearance,
		title: options.title,
		forcedScheme: options.forcedScheme,
	}
}

export function isReadyMessage(data: unknown): data is PreviewReadyMessage {
	if (typeof data !== "object" || data === null) {
		return false
	}
	const message = data as Partial<PreviewReadyMessage>
	return (
		message.source === PREVIEW_CHANNEL_SOURCE && message.version === PREVIEW_CHANNEL_VERSION && message.type === "ready"
	)
}
