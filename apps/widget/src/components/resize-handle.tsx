import type { WidgetPosition } from "@talqo/shared/widget-appearance"
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react"

import { cn } from "@talqo/ui/lib/utils"
import { useTranslation } from "react-i18next"

const RESIZE_STEP_PX = 24

type ResizeHandleProps = {
	position: WidgetPosition
	expanded: boolean
	resizing: boolean
	onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
	onResizeBy: (widthDelta: number, heightDelta: number) => void
	onToggleExpanded: () => void
}

export function ResizeHandle({
	position,
	expanded,
	resizing,
	onPointerDown,
	onResizeBy,
	onToggleExpanded,
}: ResizeHandleProps) {
	const { t } = useTranslation()

	function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		const horizontalStep = position === "bottom-left" ? RESIZE_STEP_PX : -RESIZE_STEP_PX
		let widthDelta = 0
		let heightDelta = 0
		if (event.key === "ArrowLeft") {
			widthDelta = -horizontalStep
		} else if (event.key === "ArrowRight") {
			widthDelta = horizontalStep
		} else if (event.key === "ArrowUp") {
			heightDelta = RESIZE_STEP_PX
		} else if (event.key === "ArrowDown") {
			heightDelta = -RESIZE_STEP_PX
		} else {
			return
		}
		event.preventDefault()
		onResizeBy(widthDelta, heightDelta)
	}

	return (
		<button
			type="button"
			data-testid="resize-corner"
			aria-label={expanded ? t("resetChatSize") : t("expandChat")}
			aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
			onPointerDown={onPointerDown}
			onKeyDown={handleKeyDown}
			onClick={(event) => {
				if (event.detail === 0) onToggleExpanded()
			}}
			className={cn(
				"tw:absolute tw:z-10 tw:size-6 tw:rounded-control tw:transition-opacity tw:focus-visible:ring-2 tw:focus-visible:ring-ring/50 tw:focus-visible:outline-none",
				position === "bottom-left"
					? "tw:-top-1.5 tw:-right-1.5 tw:cursor-nesw-resize"
					: "tw:-top-1.5 tw:-left-1.5 tw:cursor-nwse-resize",
				resizing ? "tw:opacity-100" : "tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"tw:absolute tw:block tw:h-10 tw:w-8 tw:border-white tw:drop-shadow-sm",
					position === "bottom-left"
						? "tw:top-1 tw:right-1 tw:rounded-tr-lg tw:border-t-6 tw:border-r-6"
						: "tw:top-1 tw:left-1 tw:rounded-tl-lg tw:border-t-6 tw:border-l-6",
				)}
			/>
		</button>
	)
}
