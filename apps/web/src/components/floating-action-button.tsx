import type { ComponentProps } from "react"

import { Button } from "@talqo/ui/components/button"
import { cn } from "@talqo/ui/lib/utils"

export function FloatingActionButton({ className, ...props }: Omit<ComponentProps<typeof Button>, "size" | "variant">) {
	return (
		<Button
			data-slot="floating-action"
			size="fab"
			className={cn("max-md:fixed max-md:right-6 max-md:bottom-6 max-md:z-20", className)}
			{...props}
		/>
	)
}
