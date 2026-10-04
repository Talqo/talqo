import { useEffect, useRef } from "react"

// Chrome's focus-driven document reset parks the page exactly at the top.
const FOCUS_RESET_SCROLL_TOP = 4
const SCROLL_RESTORE_ATTEMPTS = 12
const SCROLL_RESTORE_INTERVAL_MS = 120

// Base UI's list navigation calls scrollIntoView on the freshly highlighted option a frame
// or more after opening; while the popup still lacks final positioning, the browser may scroll
// the document to the top. Capture the scroll position while the trigger is pressed, retry the
// restore until it sticks — but stop as soon as the user scrolls anywhere themselves.
export function usePreserveScrollOnOpen(): {
	capturePreOpenScroll: () => void
	onOpenChange: (open: boolean) => void
} {
	const preOpenScrollY = useRef(0)
	const scrollRestoreTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
	// A pending restore must not keep firing after the consumer unmounts.
	useEffect(
		() => () => {
			if (scrollRestoreTimeout.current) clearTimeout(scrollRestoreTimeout.current)
		},
		[],
	)
	const capturePreOpenScroll = () => {
		preOpenScrollY.current = window.scrollY
	}
	const onOpenChange = (open: boolean) => {
		if (scrollRestoreTimeout.current) clearTimeout(scrollRestoreTimeout.current)
		if (!open || preOpenScrollY.current <= FOCUS_RESET_SCROLL_TOP) return
		const restoreY = preOpenScrollY.current
		let attemptsLeft = SCROLL_RESTORE_ATTEMPTS
		const tryRestore = () => {
			attemptsLeft -= 1
			if (window.scrollY > FOCUS_RESET_SCROLL_TOP) return
			window.scrollTo({ top: restoreY })
			if (attemptsLeft > 0) scrollRestoreTimeout.current = setTimeout(tryRestore, SCROLL_RESTORE_INTERVAL_MS)
		}
		scrollRestoreTimeout.current = setTimeout(tryRestore, SCROLL_RESTORE_INTERVAL_MS)
	}
	return { capturePreOpenScroll, onOpenChange }
}
