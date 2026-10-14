import type { ReactNode } from "react"

export function PageHeader({
	title,
	description,
	actions,
}: {
	title: string
	description: string
	actions?: ReactNode
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-4">
			<div className="max-w-full min-w-0">
				<h1 className="text-foreground truncate text-3xl font-bold" title={title}>
					{title}
				</h1>
				<p className="text-muted-foreground mt-2">{description}</p>
			</div>
			{actions}
		</div>
	)
}
