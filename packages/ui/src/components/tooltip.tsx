import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { cn } from "@talqo/ui/lib/utils"

function TooltipProvider({ ...props }: TooltipPrimitive.Provider.Props) {
	return <TooltipPrimitive.Provider data-slot="tooltip-provider" {...props} />
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
	return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
	className,
	side,
	sideOffset = 4,
	align,
	children,
	...popupProps
}: TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, "side" | "sideOffset" | "align">) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner data-slot="tooltip-positioner" side={side} sideOffset={sideOffset} align={align}>
				<TooltipPrimitive.Popup
					data-slot="tooltip-content"
					className={cn(
						"bg-primary text-primary-foreground data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 w-fit max-w-xs rounded-md px-2 py-1 text-xs duration-100",
						className,
					)}
					{...popupProps}
				>
					{children}
				</TooltipPrimitive.Popup>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	)
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
