import type { ReactNode } from "react"

function FormStatus({ children }: { children?: ReactNode }) {
	if (!children) return null
	return <output className="text-muted-foreground text-sm">{children}</output>
}

function FormActions({ discard, status, children }: { discard?: ReactNode; status?: ReactNode; children: ReactNode }) {
	return (
		<div className="flex flex-wrap items-center gap-3 pt-2">
			{discard}
			<div className="ml-auto flex flex-wrap items-center gap-3">
				<FormStatus>{status}</FormStatus>
				{children}
			</div>
		</div>
	)
}

export { FormActions }
