import type { WidgetAppearance } from "@talqo/shared/widget-appearance"

/**
 * Dashboard side of the preview channel. The widget app declares the same shape in
 * `apps/widget/src/lib/preview-channel.ts` -- apps never import each other, so the
 * contract is the wire format, kept in step by the `PREVIEW_CHANNEL_VERSION` guard.
 *
 * A version mismatch is ignored rather than thrown: a stale cached preview.html then
 * degrades to "initial paint from URL params, no live updates" instead of breaking.
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
	source: typeof PREVIEW_CHANNEL_SOURCE
	type: "config"
	version: number
}

export function configMessage(appearance: WidgetAppearance): PreviewConfigMessage {
	return { source: PREVIEW_CHANNEL_SOURCE, version: PREVIEW_CHANNEL_VERSION, type: "config", appearance }
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
