import { type ReactNode, useId } from "react"

function DangerZone({ title, children }: { title: ReactNode; children: ReactNode }) {
	const titleId = useId()

	return (
		<section
			aria-labelledby={titleId}
			className="border-destructive/50 rounded-surface p-surface-padding flex flex-col gap-4 border"
		>
			<h2 id={titleId} className="text-destructive text-base font-medium">
				{title}
			</h2>
			<div className="divide-destructive/20 divide-y">{children}</div>
		</section>
	)
}

function DangerZoneRow({
	title,
	description,
	action,
}: {
	title: ReactNode
	description?: ReactNode
	action: ReactNode
}) {
	return (
		<div className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0">
			<div className="min-w-0 space-y-1">
				<p className="text-sm font-medium">{title}</p>
				{description ? <div className="text-muted-foreground text-sm">{description}</div> : null}
			</div>
			<div className="shrink-0">{action}</div>
		</div>
	)
}

export { DangerZone, DangerZoneRow }
