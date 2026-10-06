import { useEffect, useRef } from "react"

// Chrome's focus-driven document reset parks the page exactly at the top.
const FOCUS_RESET_SCROLL_TOP = 4
const SCROLL_RESTORE_ATTEMPTS = 12
const SCROLL_RESTORE_INTERVAL_MS = 120

// Workaround for a browser-level side effect of @base-ui/react@1.8.0 (the version pinned in
// apps/web and packages/ui): the Select popup's list navigation —
// @base-ui/react/floating-ui-react/hooks/useListNavigation.js, around lines 162-172 in that
// package — calls `waitedItem.scrollIntoView({ block: 'nearest', inline: 'nearest' })` on the
// freshly highlighted option a frame or more after opening, without `{ preventScroll: true }`
// on the accompanying focus call. While the popup still lacks final positioning, that
// scrollIntoView can scroll the document to the top (Chrome parks the page at scrollY≈4).
// No upstream issue was filed at the time this was written. Capture the scroll position while
// the trigger is pressed, retry the restore until it sticks — but stop as soon as the user
// scrolls anywhere themselves. See docs/adr/0020-preserve-scroll-past-the-select-popup.md.
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
