import { CircleAlertIcon, CircleCheckIcon, ClockIcon, LoaderCircleIcon } from "lucide-react"

export const INGESTION_REFRESH_MS = 3_000

export type IngestionStatus = "pending" | "processing" | "ready" | "failed"

const styles = {
	pending: { Icon: ClockIcon, className: "text-muted-foreground" },
	processing: { Icon: LoaderCircleIcon, className: "text-amber-600 dark:text-amber-500", spin: true },
	ready: { Icon: CircleCheckIcon, className: "text-green-600 dark:text-green-500" },
	failed: { Icon: CircleAlertIcon, className: "text-destructive" },
} as const

export function IngestionStatusLine({ status, label, errorLabel }: { status: IngestionStatus; label: string; errorLabel?: string }) {
	const style = styles[status]
	const { Icon } = style
	return (
		<output className={`flex items-center gap-1.5 text-xs ${style.className}`}>
			<Icon aria-hidden className={"spin" in style && style.spin ? "size-3.5 animate-spin" : "size-3.5"} />
			<span>
				{label}
				{errorLabel ? ` · ${errorLabel}` : ""}
			</span>
		</output>
	)
}

export function hasActiveIngestion<T extends { embeddingStatus: IngestionStatus }>(sources: T[] | undefined): boolean {
	return sources?.some((source) => source.embeddingStatus === "pending" || source.embeddingStatus === "processing") ?? false
}
