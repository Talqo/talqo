import { useLanguage } from "@/lib/use-language"
import { cn } from "@talqo/ui/lib/utils"

export type WidgetPosition = "bottom-right" | "bottom-left"

// The dashboard previews the widget exactly like a customer site hosts it: in
// an iframe pointed at the widget app's preview page, configured through URL
// params. There is no compile-time dependency on apps/widget — see
// docs/architecture.md ("Apps do not import one another").
const PREVIEW_URL =
	(import.meta.env.VITE_WIDGET_PREVIEW_URL as string | undefined) ?? "http://localhost:5174/preview.html"

const insetClasses: Record<"card" | "page", Record<WidgetPosition, string>> = {
	card: {
		"bottom-right": "bottom-0 right-4",
		"bottom-left": "bottom-0 left-4",
	},
	page: {
		"bottom-right": "right-6 bottom-6",
		"bottom-left": "bottom-6 left-6",
	},
}

type WidgetPreviewProps = {
	accent?: string
	position?: WidgetPosition
	language?: string
	title?: string
	inset?: keyof typeof insetClasses
}

function previewSrc({ accent, language, title }: { accent?: string; language?: string; title?: string }) {
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

export function WidgetPreview({
	accent,
	position = "bottom-right",
	language,
	title = "AI Chat",
	inset = "card",
}: WidgetPreviewProps) {
	// An explicit prop (e.g. the widget setup page's own selector) wins;
	// otherwise previews follow the dashboard header language switch.
	const { language: preferredLanguage } = useLanguage()
	return (
		<iframe
			src={previewSrc({ accent, language: language ?? preferredLanguage, title })}
			title={title}
			// Sized to fit the open chat panel (320x384) plus the launcher button.
			className={cn("absolute h-[452px] w-[336px] border-0", insetClasses[inset][position])}
		/>
	)
}
