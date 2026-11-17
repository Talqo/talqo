import { type RefObject, useCallback, useLayoutEffect, useRef } from "react"

const STICKY_SCROLL_THRESHOLD_PX = 48

export function useStickyTranscript(open: boolean): {
	scrollRef: RefObject<HTMLDivElement | null>
	onScroll: () => void
	pinToBottom: () => void
} {
	const scrollRef = useRef<HTMLDivElement>(null)
	const stickToBottomRef = useRef(true)

	const scrollToBottom = useCallback(() => {
		const element = scrollRef.current
		if (element) {
			element.scrollTop = element.scrollHeight
		}
	}, [])

	function onScroll() {
		const element = scrollRef.current
		if (!element) return
		stickToBottomRef.current =
			element.scrollHeight - element.scrollTop - element.clientHeight <= STICKY_SCROLL_THRESHOLD_PX
	}

	function pinToBottom() {
		stickToBottomRef.current = true
	}

	useLayoutEffect(() => {
		if (open) {
			stickToBottomRef.current = true
			scrollToBottom()
		}
	}, [open, scrollToBottom])

	// No deps: re-pins after every commit while the visitor is at the bottom.
	useLayoutEffect(() => {
		if (open && stickToBottomRef.current) {
			scrollToBottom()
		}
	})

	return { scrollRef, onScroll, pinToBottom }
}
