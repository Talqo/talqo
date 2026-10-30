import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

export function EmptyState({
	icon: Icon,
	title,
	description,
	actions,
}: {
	icon: LucideIcon
	title: string
	description?: string
	actions?: ReactNode
}) {
	return (
		<div
			data-slot="empty-state"
			className="rounded-surface border-border flex flex-col items-center gap-3 border border-dashed px-6 py-10 text-center"
		>
			<span className="bg-muted text-muted-foreground rounded-full p-2.5" aria-hidden="true">
				<Icon className="size-5" />
			</span>
			<div className="space-y-1">
				<p className="text-foreground font-medium">{title}</p>
				{description && <p className="text-muted-foreground max-w-prose text-sm">{description}</p>}
			</div>
			{actions && <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{actions}</div>}
		</div>
	)
}
