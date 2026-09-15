import { configFromMessage, type PreviewConfig, readyMessage, trustedParentOrigin } from "@talqo/shared/preview-channel"
import { useEffect, useState } from "react"

import { EmbeddedWidget } from "./embedded-widget"
import { appearanceFromValues } from "./lib/embed-config"

function forcedSchemeFromSearch(params: URLSearchParams): "light" | "dark" | undefined {
	const value = params.get("forcedScheme")
	return value === "light" || value === "dark" ? value : undefined
}

export function PreviewWidget() {
	const params = new URLSearchParams(window.location.search)
	const parentOrigin = trustedParentOrigin(params.get("parentOrigin"))
	const [config, setConfig] = useState<PreviewConfig>(() => ({
		appearance: appearanceFromValues((key) => params.get(key) ?? undefined),
		title: params.get("title") ?? undefined,
		forcedScheme: forcedSchemeFromSearch(params),
	}))

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
				setConfig(next)
			}
		}
		window.addEventListener("message", onMessage)
		// Announced after the listener attaches, so the dashboard's reply cannot race it.
		window.parent.postMessage(readyMessage(), parentOrigin)
		return () => window.removeEventListener("message", onMessage)
	}, [parentOrigin])

	return <EmbeddedWidget title={config.title} appearance={config.appearance} forcedScheme={config.forcedScheme} />
}
