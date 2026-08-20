import { useCallback, useSyncExternalStore } from "react"

const QUERY = "(prefers-color-scheme: dark)"

/**
 * Tracks the host page's color-scheme preference. Server-safe and SSR-inert: the
 * widget may be mounted into a document that never matches, so absence of
 * `matchMedia` reads as "light" rather than throwing.
 */
export function usePrefersDark(): boolean {
	const subscribe = useCallback((onChange: () => void) => {
		const media = globalThis.matchMedia?.(QUERY)
		media?.addEventListener("change", onChange)
		return () => media?.removeEventListener("change", onChange)
	}, [])

	return useSyncExternalStore(
		subscribe,
		() => globalThis.matchMedia?.(QUERY).matches ?? false,
		() => false,
	)
}
