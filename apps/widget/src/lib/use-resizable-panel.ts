import type { WidgetPosition } from "@talqo/shared/widget-appearance"
import type { PointerEvent as ReactPointerEvent, RefObject } from "react"

import { useEffect, useState } from "react"

const MIN_WIDTH = 280
const MIN_HEIGHT = 320
const RESIZE_MARGIN = 32
// Excludes the launcher row and preserves top clearance.
const RESIZE_HEIGHT_MARGIN = 92

function clampPanelSize(width: number, height: number): { width: number; height: number } {
	return {
		width: Math.round(Math.min(Math.max(width, MIN_WIDTH), Math.max(MIN_WIDTH, window.innerWidth - RESIZE_MARGIN))),
		height: Math.round(
			Math.min(Math.max(height, MIN_HEIGHT), Math.max(MIN_HEIGHT, window.innerHeight - RESIZE_HEIGHT_MARGIN)),
		),
	}
}

export function useResizablePanel(position: WidgetPosition | undefined, panelRef: RefObject<HTMLDivElement | null>) {
	const [size, setSize] = useState<{ width: number; height: number } | null>(null)
	const [resizable, setResizable] = useState(
		() => typeof window !== "undefined" && window.matchMedia("(min-width: 640px) and (pointer: fine)").matches,
	)
	const [resizing, setResizing] = useState(false)

	useEffect(() => {
		const query = window.matchMedia("(min-width: 640px) and (pointer: fine)")
		const onChange = (event: MediaQueryListEvent) => {
			setResizable(event.matches)
			if (!event.matches) setSize(null)
		}
		query.addEventListener("change", onChange)
		return () => query.removeEventListener("change", onChange)
	}, [])

	function startResize(event: ReactPointerEvent<HTMLDivElement>) {
		if (event.pointerType === "touch" || !panelRef.current) return
		event.preventDefault()
		setResizing(true)
		const anchor = panelRef.current.getBoundingClientRect()
		const side = position === "bottom-left" ? "left" : "right"
		const anchorX = side === "right" ? anchor.right : anchor.left
		const anchorBottom = anchor.bottom
		const pointerId = event.pointerId

		function handleMove(moveEvent: PointerEvent) {
			if (moveEvent.pointerId !== pointerId) return
			const rawWidth = side === "right" ? anchorX - moveEvent.clientX : moveEvent.clientX - anchorX
			setSize(clampPanelSize(rawWidth, anchorBottom - moveEvent.clientY))
		}

		function handleEnd(endEvent: PointerEvent) {
			if (endEvent.pointerId !== pointerId) return
			setResizing(false)
			window.removeEventListener("pointermove", handleMove)
			window.removeEventListener("pointerup", handleEnd)
			window.removeEventListener("pointercancel", handleEnd)
		}

		window.addEventListener("pointermove", handleMove)
		window.addEventListener("pointerup", handleEnd)
		window.addEventListener("pointercancel", handleEnd)
	}

	return { size, resizable, startResize, resizing }
}
