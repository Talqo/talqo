import type { ComponentProps, CSSProperties } from "react"

import logoUrl from "@talqo/ui/assets/logo.svg"
import { cn } from "@talqo/ui/lib/utils"

// A mask paints the logo in currentColor, so it follows the app theme rather than the OS color scheme.
const logoMask = { "--logo-mask": `url("${logoUrl}")` } as CSSProperties

function Logo({ className, style, ...props }: ComponentProps<"span">) {
	return (
		<span
			aria-hidden
			data-slot="logo"
			className={cn(
				"inline-block shrink-0 bg-current mask-(--logo-mask) mask-contain mask-center mask-no-repeat",
				className,
			)}
			style={{ ...logoMask, ...style }}
			{...props}
		/>
	)
}

export { Logo }
