import { cn } from "@talqo/ui/lib/utils"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

export type WidgetPosition = "bottom-right" | "bottom-left"

// The dashboard previews the widget exactly like a customer site hosts it: in
// an iframe pointed at the widget app's preview page, configured through URL
// params. There is no compile-time dependency on apps/widget — see
// docs/architecture.md ("Apps do not import one another").
//
// The widget build ships only widget.js/css — no hosted preview page exists —
// so a preview target must come from configuration. scripts/dev.ts points this
// at the widget dev server; any other deployment sets its own. Without one the
// preview degrades to a notice instead of iframing a dead localhost address.
const PREVIEW_URL =
	(import.meta.env.VITE_WIDGET_PREVIEW_URL as string | undefined) ??
	(import.meta.env.DEV ? "http://localhost:5174/preview.html" : undefined)

const insetClasses: Record<WidgetPosition, string> = {
	// The widget fixes itself to the iframe corner, so the iframe sits flush;
	// its size covers the open panel (320x384) plus the launcher and offsets.
	"bottom-right": "right-0 bottom-0",
	"bottom-left": "bottom-0 left-0",
}

type WidgetPreviewProps = {
	accent?: string
	position?: WidgetPosition
	language?: string
	title?: string
}

function previewSrc({ accent, language, title }: { accent?: string; language?: string; title?: string }) {
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
	return url.toString()
}

// Reloading the iframe on every accent keystroke flickers and re-runs the
// widget boot, so src changes settle briefly before being applied.
function useDebouncedValue<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const timeout = window.setTimeout(() => setDebounced(value), delayMs)
		return () => window.clearTimeout(timeout)
	}, [value, delayMs])
	return debounced
}

export function WidgetPreview({ accent, position = "bottom-right", language, title = "AI Chat" }: WidgetPreviewProps) {
	const { t } = useTranslation()
	const src = useMemo(() => previewSrc({ accent, language, title }), [accent, language, title])
	const debouncedSrc = useDebouncedValue(src, 300)

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
		<iframe
			src={debouncedSrc}
			title={title}
			// Sized to fit the open chat panel (320x384) plus the launcher button
			// and the widget's own fixed corner offset.
			className={cn("absolute h-[460px] w-[336px] border-0", insetClasses[position])}
		/>
	)
}
