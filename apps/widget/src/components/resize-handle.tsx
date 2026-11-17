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
				"tw:absolute tw:z-10 tw:flex tw:h-6 tw:w-8 tw:items-start tw:justify-center tw:rounded-control tw:transition-opacity tw:focus-visible:ring-2 tw:focus-visible:ring-ring/50 tw:focus-visible:outline-none",
				position === "bottom-left"
					? "tw:top-0 tw:right-2 tw:cursor-nesw-resize"
					: "tw:top-0 tw:left-2 tw:cursor-nwse-resize",
				resizing ? "tw:opacity-100" : "tw:opacity-0 tw:group-hover:opacity-100 tw:focus-visible:opacity-100",
			)}
		>
			<span aria-hidden="true" className="tw:block tw:h-0.5 tw:w-6 tw:rounded-full tw:bg-white" />
		</button>
	)
}
