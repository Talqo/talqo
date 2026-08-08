import { cn } from "@talqo/ui/lib/utils"
import { type RefObject, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

export type WidgetPosition = "bottom-right" | "bottom-left"

const PREVIEW_URL =
	(import.meta.env.VITE_WIDGET_PREVIEW_URL as string | undefined) ??
	(import.meta.env.DEV ? "http://localhost:5174/preview.html" : undefined)

// The widget fixes itself to the iframe corner, so the frame sits flush. It is
// sized for the open panel plus the launcher and the widget's corner offset.
const FRAME_WIDTH = 336

const insetClasses: Record<WidgetPosition, string> = {
	"bottom-right": "right-0 bottom-0",
	"bottom-left": "bottom-0 left-0",
}

type WidgetPreviewProps = {
	accent?: string
	position?: WidgetPosition
	language?: string
	title?: string
}

function previewSrc({
	accent,
	language,
	title,
	position,
}: {
	accent?: string
	language?: string
	title?: string
	position?: WidgetPosition
}) {
	if (!PREVIEW_URL) {
		return undefined
	}
	const url = new URL(PREVIEW_URL)
	if (accent) {
		url.searchParams.set("accent", accent)
	}
	if (language) {
		url.searchParams.set("language", language)
	}
	if (title) {
		url.searchParams.set("title", title)
	}
	if (position) {
		url.searchParams.set("position", position)
	}
	return url.toString()
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const timeout = window.setTimeout(() => setDebounced(value), delayMs)
		return () => window.clearTimeout(timeout)
	}, [value, delayMs])
	return debounced
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

export function WidgetPreview({ accent, position = "bottom-right", language, title }: WidgetPreviewProps) {
	const { t } = useTranslation()
	const src = useMemo(() => previewSrc({ accent, language, title, position }), [accent, language, title, position])
	const debouncedSrc = useDebouncedValue(src, 300)
	const frameRef = useRef<HTMLDivElement>(null)
	const scale = useFrameScale(frameRef)

	if (!debouncedSrc) {
		return (
			<div
				className={cn(
					"text-muted-foreground absolute flex h-32 w-[336px] items-center justify-center text-sm",
					insetClasses[position],
				)}
			>
				{t("widgetSetup.previewUnavailable")}
			</div>
		)
	}

	return (
		<div ref={frameRef} className={cn("absolute h-[460px] w-full max-w-[336px]", insetClasses[position])}>
			<iframe
				src={debouncedSrc}
				title={t("widgetSetup.livePreview")}
				className={cn("absolute h-[460px] w-[336px] border-0", position === "bottom-right" ? "right-0" : "left-0")}
				style={{
					transform: `scale(${scale})`,
					transformOrigin: position === "bottom-right" ? "bottom right" : "bottom left",
				}}
			/>
		</div>
	)
}
