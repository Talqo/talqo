import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

// shadcn/ui-derived chat bubble, vendored into the widget app: the embed build
// hardcodes the tw: utility prefix, which the unprefixed packages/ui
// components cannot provide. Only the variants the widget uses are kept.
const bubbleContentVariants = {
	default: "tw:bg-primary tw:text-primary-foreground",
	muted: "tw:bg-muted",
} as const

export type BubbleVariant = keyof typeof bubbleContentVariants

function BubbleGroup({ className, ...props }: ComponentProps<"div">) {
	return (
		<div data-slot="bubble-group" className={cn("tw:flex tw:min-w-0 tw:flex-col tw:gap-2", className)} {...props} />
	)
}

function Bubble({ align = "start", className, ...props }: ComponentProps<"div"> & { align?: "start" | "end" }) {
	return (
		<div
			data-slot="bubble"
			data-align={align}
			className={cn(
				"tw:flex tw:w-fit tw:max-w-[80%] tw:min-w-0 tw:flex-col tw:gap-1 tw:data-[align=end]:self-end",
				className,
			)}
			{...props}
		/>
	)
}

function BubbleContent({
	variant = "default",
	className,
	...props
}: ComponentProps<"div"> & { variant?: BubbleVariant }) {
	return (
		<div
			data-slot="bubble-content"
			className={cn(
				"tw:wrap-break-word tw:w-fit tw:min-w-0 tw:max-w-full tw:rounded-xl tw:px-3 tw:py-2 tw:text-sm tw:leading-relaxed tw:group-data-[align=end]/bubble:self-end",
				bubbleContentVariants[variant],
				className,
			)}
			{...props}
		/>
	)
}

export { BubbleGroup, Bubble, BubbleContent }
