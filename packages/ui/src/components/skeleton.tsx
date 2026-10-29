import { cn } from "@talqo/ui/lib/utils"
import * as React from "react"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			aria-hidden="true"
			className={cn("bg-muted animate-pulse rounded-md motion-reduce:animate-none", className)}
			{...props}
		/>
	)
}

export { Skeleton }
