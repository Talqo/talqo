import { type RefObject, useEffect, useRef } from "react"

const TITLE_SEPARATOR = " · "

export function useRouteHeading(pathname: string, main: RefObject<HTMLElement | null>, appName: string) {
	const previousPath = useRef(pathname)
	const seenHeading = useRef<HTMLElement | null>(null)

	useEffect(() => {
		const element = main.current
		if (!element) return undefined
		let pendingFocus = previousPath.current !== pathname
		previousPath.current = pathname

		const sync = () => {
			const heading = element.querySelector<HTMLElement>("h1")
			if (!heading) return
			const text = heading.textContent?.trim()
			const title = text ? `${text}${TITLE_SEPARATOR}${appName}` : appName
			if (document.title !== title) document.title = title
			// The previous page's heading stays mounted during a transition; skip it.
			if (pendingFocus && heading !== seenHeading.current) {
				heading.focus()
				pendingFocus = false
			}
			seenHeading.current = heading
		}

		sync()
		const observer = new MutationObserver(sync)
		observer.observe(element, { characterData: true, childList: true, subtree: true })
		return () => observer.disconnect()
	}, [appName, main, pathname])
}
