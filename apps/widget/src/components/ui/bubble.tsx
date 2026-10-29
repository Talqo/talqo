import type { ComponentProps } from "react"

import { cn } from "@talqo/ui/lib/utils"

const bubbleContentVariants = {
	default: "tw:bg-primary tw:text-primary-foreground",
	muted: "tw:bg-muted tw:text-foreground",
} as const

type BubbleVariant = keyof typeof bubbleContentVariants

function BubbleGroup({ className, ...props }: ComponentProps<"ul">) {
	return (
		<ul
			data-slot="bubble-group"
			className={cn("tw:m-0 tw:flex tw:min-w-0 tw:list-none tw:flex-col tw:gap-2 tw:p-0", className)}
			{...props}
		/>
	)
}

function Bubble({ align = "start", className, ...props }: ComponentProps<"li"> & { align?: "start" | "end" }) {
	return (
		<li
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
				"tw:wrap-break-word tw:w-fit tw:min-w-0 tw:max-w-full tw:rounded-surface tw:px-3.5 tw:py-2.5 tw:text-sm tw:leading-relaxed tw:group-data-[align=end]/bubble:self-end",
				bubbleContentVariants[variant],
				className,
			)}
			{...props}
		/>
	)
}

export { BubbleGroup, Bubble, BubbleContent }
