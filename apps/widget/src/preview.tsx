import type { WidgetAppearanceInput } from "@talqo/shared/widget-appearance"

import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { EmbeddedWidget } from "./embedded-widget"
import { configFromMessage, readyMessage, trustedParentOrigin } from "./lib/preview-channel"

/** Initial paint only; every later edit arrives over the preview channel. */
function appearanceFromSearch(params: URLSearchParams): WidgetAppearanceInput {
	const entries: Record<string, unknown> = {
		primary: params.get("primary") ?? params.get("accent") ?? undefined,
		primaryForeground: params.get("primaryForeground") ?? undefined,
		background: params.get("background") ?? undefined,
		foreground: params.get("foreground") ?? undefined,
		position: params.get("position") ?? undefined,
		theme: params.get("theme") ?? undefined,
		language: params.get("language") ?? undefined,
		themeToggle: params.has("themeToggle") ? params.get("themeToggle") === "true" : undefined,
	}
	return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))
}

function PreviewWidget({
	initialAppearance,
	parentOrigin,
	title,
}: {
	initialAppearance: WidgetAppearanceInput
	parentOrigin: string | undefined
	title: string | undefined
}) {
	const [appearance, setAppearance] = useState(initialAppearance)

	useEffect(() => {
		if (!parentOrigin) {
			return
		}
		function onMessage(event: MessageEvent) {
			if (event.origin !== parentOrigin) {
				return
			}
			const next = configFromMessage(event.data)
			if (next) {
				setAppearance(next)
			}
		}
		window.addEventListener("message", onMessage)
		// Announce after the listener is attached, so the dashboard's reply cannot race
		// it. Posting on load instead would risk arriving before React mounted.
		window.parent.postMessage(readyMessage(), parentOrigin)
		return () => window.removeEventListener("message", onMessage)
	}, [parentOrigin])

	return <EmbeddedWidget title={title} appearance={appearance} />
}

const params = new URLSearchParams(window.location.search)
const rootElement = document.querySelector("#talqo-widget")

if (!(rootElement instanceof HTMLElement)) {
	throw new Error("Root element not found")
}

createRoot(rootElement).render(
	<PreviewWidget
		initialAppearance={appearanceFromSearch(params)}
		parentOrigin={trustedParentOrigin(params.get("parentOrigin"))}
		title={params.get("title") ?? undefined}
	/>,
)
