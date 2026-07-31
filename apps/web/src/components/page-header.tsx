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
				<h1 className="font-bold text-3xl text-foreground">{title}</h1>
				<p className="mt-2 text-muted-foreground">{description}</p>
			</div>
			{actions}
		</div>
	)
}
