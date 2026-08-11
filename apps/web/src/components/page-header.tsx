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
			<div>
				<h1 className="text-foreground text-3xl font-bold">{title}</h1>
				<p className="text-muted-foreground mt-2">{description}</p>
			</div>
			{actions}
		</div>
	)
}
