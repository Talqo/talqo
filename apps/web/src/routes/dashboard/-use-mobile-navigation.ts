import { useRouter } from "@tanstack/react-router"
import { useCallback, useEffect, useRef, useState } from "react"

export function useMobileNavigation() {
	const router = useRouter()
	const [open, setOpen] = useState(false)
	const toggleRef = useRef<HTMLButtonElement>(null)
	const panelRef = useRef<HTMLDivElement>(null)
	const close = () => setOpen(false)
	const toggleOpen = () => setOpen((value) => !value)
	const closeAndRestoreFocus = useCallback(() => {
		setOpen(false)
		toggleRef.current?.focus()
	}, [])

	useEffect(() => router.subscribe("onBeforeNavigate", () => setOpen(false)), [router])

	useEffect(() => {
		if (!open) return undefined
		panelRef.current?.querySelector<HTMLElement>("a, button")?.focus()

		function onKeyDown(event: KeyboardEvent) {
			if (event.key !== "Escape") return
			event.stopPropagation()
			closeAndRestoreFocus()
		}
		function onPointerDown(event: PointerEvent) {
			const target = event.target
			if (!(target instanceof Node)) return
			if (panelRef.current?.contains(target) || toggleRef.current?.contains(target)) return
			closeAndRestoreFocus()
		}
		document.addEventListener("keydown", onKeyDown)
		document.addEventListener("pointerdown", onPointerDown)
		return () => {
			document.removeEventListener("keydown", onKeyDown)
			document.removeEventListener("pointerdown", onPointerDown)
		}
	}, [open, closeAndRestoreFocus])

	return { open, toggleOpen, toggleRef, panelRef, close, closeAndRestoreFocus }
}
