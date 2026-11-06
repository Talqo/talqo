import type { ComponentProps } from "react"

import { Button } from "@talqo/ui/components/button"
import { cn } from "@talqo/ui/lib/utils"

// The page's primary action: floats below md, sits in PageHeader actions from md up.
// The dashboard layout reserves bottom space below md so it never covers the last content.
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
