import type { ComponentProps, ReactNode } from "react"

import { Card, CardDescription, CardHeader } from "@talqo/ui/components/card"

function MetricCard({
	className,
	label,
	value,
	...props
}: Omit<ComponentProps<"div">, "children"> & { label: ReactNode; value: ReactNode }) {
	return (
		<Card className={className} {...props}>
			<CardHeader>
				<CardDescription>{label}</CardDescription>
				<p className="text-2xl font-medium">{value}</p>
			</CardHeader>
		</Card>
	)
}

export { MetricCard }
