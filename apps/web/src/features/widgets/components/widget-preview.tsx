import type { WidgetAppearance, WidgetPosition } from "@talqo/shared/widget-appearance"

import { configMessage, isReadyMessage } from "@/features/widgets/preview-channel.ts"
import { cn } from "@talqo/ui/lib/utils"
import { type RefObject, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

const PREVIEW_URL =
	(import.meta.env.VITE_WIDGET_PREVIEW_URL as string | undefined) ??
	(import.meta.env.DEV ? "http://localhost:5174/preview.html" : undefined)

const FRAME_WIDTH = 336

const insetClasses: Record<WidgetPosition, string> = {
	"bottom-right": "right-0 bottom-0",
	"bottom-left": "bottom-0 left-0",
}

type WidgetPreviewProps = {
	appearance: WidgetAppearance
	/** Changing this remounts the frame; appearance edits never do. */
	previewKey: string
}

/** Carries the first paint only; later edits go over postMessage. */
function previewSrc(appearance: WidgetAppearance): string | undefined {
	if (!PREVIEW_URL) {
		return undefined
	}
	const url = new URL(PREVIEW_URL)
	url.searchParams.set("primary", appearance.primary)
	url.searchParams.set("primaryForeground", appearance.primaryForeground)
	url.searchParams.set("background", appearance.background)
	url.searchParams.set("foreground", appearance.foreground)
	url.searchParams.set("position", appearance.position)
	url.searchParams.set("theme", appearance.theme)
	url.searchParams.set("themeToggle", String(appearance.themeToggle))
	url.searchParams.set("language", appearance.language)
	// Echoed back as the child's postMessage target; the two apps can sit on different origins.
	url.searchParams.set("parentOrigin", window.location.origin)
	return url.toString()
}

function useFrameScale(ref: RefObject<HTMLDivElement | null>): number {
	const [scale, setScale] = useState(1)
	useEffect(() => {
		const frame = ref.current
		if (!frame) {
			return
		}
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setScale(Math.min(1, entry.contentRect.width / FRAME_WIDTH))
			}
		})
		observer.observe(frame)
		return () => {
			observer.disconnect()
		}
	}, [ref])
	return scale
}

/**
 * Frames the real widget bundle rather than a dashboard-side replica, so the preview
 * cannot drift from what customers see and the widget's scoped CSS stays isolated.
 */
export function WidgetPreview({ appearance, previewKey }: WidgetPreviewProps) {
	const { t } = useTranslation()
	const frameRef = useRef<HTMLDivElement>(null)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const scale = useFrameScale(frameRef)

	// Once per widget: recomputing per keystroke would reload the frame.
	const [src] = useState(() => previewSrc(appearance))
	const latestAppearance = useRef(appearance)
	// Out of the `ready` effect's deps to avoid a re-subscribe per keystroke.
	useEffect(() => {
		latestAppearance.current = appearance
	}, [appearance])

	const targetOrigin = src ? new URL(src).origin : undefined

	useEffect(() => {
		if (!targetOrigin) {
			return
		}
		function onMessage(event: MessageEvent) {
			// Replying on `ready` rather than on iframe load makes reload, HMR, and bfcache
			// restore self-healing without a retry timer.
			if (event.origin !== targetOrigin || !isReadyMessage(event.data)) {
				return
			}
			iframeRef.current?.contentWindow?.postMessage(configMessage(latestAppearance.current), targetOrigin)
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [targetOrigin])

	useEffect(() => {
		if (!targetOrigin) {
			return
		}
		// Dropped harmlessly if the child is not listening yet; its next `ready` re-syncs.
		iframeRef.current?.contentWindow?.postMessage(configMessage(appearance), targetOrigin)
	}, [appearance, targetOrigin])

	if (!src) {
		return (
			<div
				className={cn(
					"text-muted-foreground absolute flex h-32 w-[336px] items-center justify-center text-sm",
					insetClasses[appearance.position],
				)}
			>
				{t("widgetSetup.previewUnavailable")}
			</div>
		)
	}

	return (
		<div ref={frameRef} className={cn("absolute h-[460px] w-full max-w-[336px]", insetClasses[appearance.position])}>
			<iframe
				key={previewKey}
				ref={iframeRef}
				src={src}
				title={t("widgetSetup.livePreview")}
				className={cn(
					"absolute h-[460px] w-[336px] border-0",
					appearance.position === "bottom-right" ? "right-0" : "left-0",
				)}
				style={{
					transform: `scale(${scale})`,
					transformOrigin: appearance.position === "bottom-right" ? "bottom right" : "bottom left",
				}}
			/>
		</div>
	)
}
