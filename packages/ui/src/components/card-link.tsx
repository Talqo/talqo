import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cn } from "@talqo/ui/lib/utils"

// Stretches over the nearest positioned card so the whole card is one link target. Interactive
// children stay clickable by rendering above it with `relative z-10`.
function CardLink({ className, render, ...props }: useRender.ComponentProps<"a">) {
	return useRender({
		defaultTagName: "a",
		props: mergeProps<"a">(
			{
				className: cn(
					"focus-visible:ring-ring absolute inset-0 z-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset",
					className,
				),
			},
			props,
		),
		render,
		state: { slot: "card-link" },
	})
}

export { CardLink }
