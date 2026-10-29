import { useRender } from "@base-ui/react/use-render"
import { cn } from "@talqo/ui/lib/utils"

// Requires a positioned card; interactive children need relative z-10.
function CardLink({ className, render, ...props }: useRender.ComponentProps<"a">) {
	return useRender({
		defaultTagName: "a",
		props: {
			...props,
			className: cn(
				"focus-visible:ring-ring absolute inset-0 z-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-inset",
				className,
			),
		},
		render,
		state: { slot: "card-link" },
	})
}

export { CardLink }
