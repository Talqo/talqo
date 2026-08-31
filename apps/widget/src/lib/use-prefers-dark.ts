import { useCallback, useSyncExternalStore } from "react"

const QUERY = "(prefers-color-scheme: dark)"

/** Missing `matchMedia` reads as light: the widget may mount into a document without it. */
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
