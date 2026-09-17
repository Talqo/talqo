import type { WidgetAppearance, WidgetPosition, WidgetScheme } from "@talqo/shared/widget-appearance"

import { configMessage, isReadyMessage } from "@talqo/shared/preview-channel"
import { cn } from "@talqo/ui/lib/utils"
import { type RefObject, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

const configuredPreviewUrl = import.meta.env.VITE_WIDGET_PREVIEW_URL as string | undefined
const widgetUrl = import.meta.env.VITE_WIDGET_CDN_URL as string | undefined

const FRAME_WIDTH = 336
const FRAME_HEIGHT = 420

function escapeAttribute(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** A CDN-only deployment does not need to publish a separate preview document. */
export function buildPreviewDocument(scriptUrl: string, parentOrigin: string): string {
	return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>html,body{margin:0;background:transparent}</style></head><body><div id="talqo-widget"></div><script src="${escapeAttribute(scriptUrl)}" data-talqo-preview data-talqo-parent-origin="${escapeAttribute(parentOrigin)}"></script></body></html>`
}

const insetClasses: Record<WidgetPosition, string> = {
	"bottom-right": "right-0 bottom-0",
	"bottom-left": "bottom-0 left-0",
}

type WidgetPreviewProps = {
	appearance: WidgetAppearance
	title?: string
	/** Which tab the operator is editing; forces the preview to that scheme. Omit to let the
	 * embed pick its own scheme from the operator's theme setting, like the real widget does. */
	activeScheme?: "light" | "dark"
	/** Changing this remounts the frame; appearance edits never do. */
	previewKey: string
}

function schemeSearchParams(url: URL, prefix: "light" | "dark", scheme: WidgetScheme) {
	url.searchParams.set(`${prefix}Primary`, scheme.primary)
	url.searchParams.set(`${prefix}TextOnPrimary`, scheme.textOnPrimary)
	url.searchParams.set(`${prefix}Background`, scheme.background)
	url.searchParams.set(`${prefix}Surface`, scheme.surface)
	url.searchParams.set(`${prefix}Text`, scheme.text)
}

/** Carries the first paint only; later edits go over postMessage. */
function previewSrc(
	appearance: WidgetAppearance,
	title: string | undefined,
	activeScheme: "light" | "dark" | undefined,
) {
	if (!configuredPreviewUrl) {
		return undefined
	}
	const url = new URL(configuredPreviewUrl)
	schemeSearchParams(url, "light", appearance.light)
	schemeSearchParams(url, "dark", appearance.dark)
	url.searchParams.set("position", appearance.position)
	url.searchParams.set("theme", appearance.theme)
	url.searchParams.set("themeToggle", String(appearance.themeToggle))
	url.searchParams.set("language", appearance.language)
	if (activeScheme) {
		url.searchParams.set("forcedScheme", activeScheme)
	}
	if (title) {
		url.searchParams.set("title", title)
	}
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
export function WidgetPreview({ appearance, title, activeScheme, previewKey }: WidgetPreviewProps) {
	const { t } = useTranslation()
	const frameRef = useRef<HTMLDivElement>(null)
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const scale = useFrameScale(frameRef)

	// Once per widget: recomputing per keystroke would reload the frame.
	const [source] = useState(() => {
		const src = previewSrc(appearance, title, activeScheme)
		if (src) {
			const origin = new URL(src).origin
			return { expectedOrigin: origin, src, srcDoc: undefined, targetOrigin: origin }
		}
		if (widgetUrl) {
			return {
				expectedOrigin: "null",
				src: undefined,
				srcDoc: buildPreviewDocument(widgetUrl, window.location.origin),
				targetOrigin: "*",
			}
		}
		return undefined
	})
	const latest = useRef({ appearance, title, activeScheme })
	// Out of the `ready` effect's deps to avoid a re-subscribe per keystroke.
	useEffect(() => {
		latest.current = { appearance, title, activeScheme }
	}, [appearance, title, activeScheme])

	const targetOrigin = source?.targetOrigin

	useEffect(() => {
		if (!targetOrigin) {
			return
		}
		const messageTargetOrigin = targetOrigin
		function onMessage(event: MessageEvent) {
			// Replying on `ready` rather than on iframe load makes reload, HMR, and bfcache
			// restore self-healing without a retry timer.
			if (
				event.source !== iframeRef.current?.contentWindow ||
				event.origin !== source?.expectedOrigin ||
				!isReadyMessage(event.data)
			) {
				return
			}
			iframeRef.current?.contentWindow?.postMessage(
				configMessage(latest.current.appearance, {
					title: latest.current.title,
					forcedScheme: latest.current.activeScheme,
				}),
				messageTargetOrigin,
			)
		}
		window.addEventListener("message", onMessage)
		return () => window.removeEventListener("message", onMessage)
	}, [source?.expectedOrigin, targetOrigin])

	useEffect(() => {
		if (!targetOrigin) {
			return
		}
		// Dropped harmlessly if the child is not listening yet; its next `ready` re-syncs.
		iframeRef.current?.contentWindow?.postMessage(
			configMessage(appearance, { title, forcedScheme: activeScheme }),
			targetOrigin,
		)
	}, [appearance, title, activeScheme, targetOrigin])

	if (!source) {
		return (
			<div
				className={cn(
					"text-muted-foreground absolute flex h-32 w-[336px] items-center justify-center text-sm",
					insetClasses[appearance.position],
				)}
			>
				{t("embedSetup.previewUnavailable")}
			</div>
		)
	}

	return (
		<div
			ref={frameRef}
			className={cn("absolute z-10 h-[420px] w-full max-w-[336px]", insetClasses[appearance.position])}
		>
			<iframe
				key={previewKey}
				ref={iframeRef}
				src={source.src}
				srcDoc={source.srcDoc}
				sandbox={source.srcDoc ? "allow-scripts" : undefined}
				title={t("embedSetup.livePreview")}
				className={cn("absolute w-[336px] border-0", appearance.position === "bottom-right" ? "right-0" : "left-0")}
				style={{
					height: FRAME_HEIGHT,
					transform: `scale(${scale})`,
					transformOrigin: appearance.position === "bottom-right" ? "bottom right" : "bottom left",
				}}
			/>
		</div>
	)
}
