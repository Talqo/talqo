import type { ReactNode } from "react"

export function PageHeader({
	title,
	description,
	actions,
}: {
	title: string
	description?: string
	actions?: ReactNode
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-4">
			<div className="max-w-full min-w-0">
				<h1
					className="text-foreground focus-visible:ring-ring/50 truncate rounded-sm text-3xl font-bold outline-none focus-visible:ring-3"
					title={title}
					tabIndex={-1}
				>
					{title}
				</h1>
				{description && <p className="text-muted-foreground mt-2">{description}</p>}
			</div>
			{actions}
		</div>
	)
}
