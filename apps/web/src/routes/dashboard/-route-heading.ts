import { type RefObject, useEffect, useRef } from "react"

const TITLE_SEPARATOR = " · "

/**
 * Keeps the document title aligned with the page heading and focuses it on route changes.
 * The observer covers headings that appear after data loads.
 */
export function useRouteHeading(pathname: string, main: RefObject<HTMLElement | null>, appName: string) {
	const previousPath = useRef(pathname)

	useEffect(() => {
		const element = main.current
		if (!element) return undefined
		const focusOnRender = previousPath.current !== pathname
		previousPath.current = pathname
		let focusedHeading: HTMLElement | null = null

		const sync = () => {
			const heading = element.querySelector<HTMLElement>("h1")
			if (!heading) return
			const text = heading.textContent?.trim()
			const title = text ? `${text}${TITLE_SEPARATOR}${appName}` : appName
			if (document.title !== title) document.title = title
			// The old heading can still be mounted during a transition; refocus when it is replaced.
			if (focusOnRender && heading !== focusedHeading) {
				heading.focus()
				focusedHeading = heading
			}
		}

		sync()
		const observer = new MutationObserver(sync)
		observer.observe(element, { characterData: true, childList: true, subtree: true })
		return () => observer.disconnect()
	}, [appName, main, pathname])
}
