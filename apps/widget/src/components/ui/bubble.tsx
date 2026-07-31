import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"
import { cva, type VariantProps } from "class-variance-authority"

function BubbleGroup({ className, ...props }: ComponentProps<"div">) {
	return (
		<div data-slot="bubble-group" className={cn("tw:flex tw:min-w-0 tw:flex-col tw:gap-2", className)} {...props} />
	)
}

const bubbleVariants = cva(
	"tw:group/bubble tw:relative tw:flex tw:w-fit tw:max-w-[80%] tw:min-w-0 tw:flex-col tw:gap-1 tw:group-data-[align=end]/message:self-end tw:data-[align=end]:self-end tw:data-[variant=ghost]:max-w-full",
	{
		variants: {
			variant: {
				default:
					"tw:*:data-[slot=bubble-content]:bg-primary tw:*:data-[slot=bubble-content]:text-primary-foreground tw:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/80",
				secondary:
					"tw:*:data-[slot=bubble-content]:bg-secondary tw:*:data-[slot=bubble-content]:text-secondary-foreground tw:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--talqo-secondary),var(--talqo-foreground)_5%)]",
				muted:
					"tw:*:data-[slot=bubble-content]:bg-muted tw:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--talqo-muted),var(--talqo-foreground)_5%)]",
				tinted:
					"tw:*:data-[slot=bubble-content]:bg-[oklch(from_var(--talqo-primary)_0.93_calc(c*0.4)_h)] tw:*:data-[slot=bubble-content]:text-foreground tw:dark:*:data-[slot=bubble-content]:bg-[oklch(from_var(--talqo-primary)_0.3_calc(c*0.4)_h)] tw:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[oklch(from_var(--talqo-primary)_0.88_calc(c*0.5)_h)] tw:dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[oklch(from_var(--talqo-primary)_0.35_calc(c*0.5)_h)]",
				outline:
					"tw:*:data-[slot=bubble-content]:border-border tw:*:data-[slot=bubble-content]:bg-background tw:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted tw:[&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground tw:dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-input/30",
				ghost:
					"tw:border-none tw:*:data-[slot=bubble-content]:rounded-none tw:*:data-[slot=bubble-content]:bg-transparent tw:*:data-[slot=bubble-content]:p-0 tw:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted tw:[&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground tw:dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/50",
				destructive:
					"tw:*:data-[slot=bubble-content]:bg-destructive/10 tw:*:data-[slot=bubble-content]:text-destructive tw:dark:*:data-[slot=bubble-content]:bg-destructive/20 tw:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/20 tw:dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/30",
			},
		},
		defaultVariants: {
			variant: "default",
		},
	},
)

function Bubble({
	variant = "default",
	align = "start",
	className,
	...props
}: ComponentProps<"div"> &
	VariantProps<typeof bubbleVariants> & {
		align?: "start" | "end"
	}) {
	return (
		<div
			data-slot="bubble"
			data-variant={variant}
			data-align={align}
			className={cn(bubbleVariants({ variant }), className)}
			{...props}
		/>
	)
}

function BubbleContent({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="bubble-content"
			className={cn(
				"tw:wrap-break-word tw:w-fit tw:min-w-0 tw:max-w-full tw:overflow-hidden tw:rounded-xl tw:border tw:border-transparent tw:px-3 tw:py-2 tw:text-sm tw:leading-relaxed tw:group-data-[align=end]/bubble:self-end tw:[button,a]:outline-none tw:[button,a]:transition-colors tw:[button,a]:focus-visible:border-ring tw:[button,a]:focus-visible:ring-3 tw:[button,a]:focus-visible:ring-ring/50 tw:[button]:text-left",
				className,
			)}
			{...props}
		/>
	)
}

export { BubbleGroup, Bubble, BubbleContent }
