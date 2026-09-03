import type { WidgetAppearanceInput, WidgetSchemeInput } from "@talqo/shared/widget-appearance"

import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"

import { EmbeddedWidget } from "./embedded-widget"
import { configFromMessage, type PreviewConfig, readyMessage, trustedParentOrigin } from "./lib/preview-channel"

function schemeFromSearch(params: URLSearchParams, prefix: "light" | "dark"): WidgetSchemeInput {
	const entries: Record<string, unknown> = {
		primary: params.get(`${prefix}Primary`) ?? (prefix === "light" ? params.get("accent") : undefined) ?? undefined,
		textOnPrimary: params.get(`${prefix}TextOnPrimary`) ?? undefined,
		background: params.get(`${prefix}Background`) ?? undefined,
		surface: params.get(`${prefix}Surface`) ?? undefined,
		text: params.get(`${prefix}Text`) ?? undefined,
	}
	return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))
}

/** Initial paint only; every later edit arrives over the preview channel. */
function appearanceFromSearch(params: URLSearchParams): WidgetAppearanceInput {
	const entries: Record<string, unknown> = {
		light: schemeFromSearch(params, "light"),
		dark: schemeFromSearch(params, "dark"),
		position: params.get("position") ?? undefined,
		theme: params.get("theme") ?? undefined,
		language: params.get("language") ?? undefined,
		themeToggle: params.has("themeToggle") ? params.get("themeToggle") === "true" : undefined,
	}
	return Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined))
}

function forcedSchemeFromSearch(params: URLSearchParams): "light" | "dark" | undefined {
	const value = params.get("forcedScheme")
	return value === "light" || value === "dark" ? value : undefined
}

function PreviewWidget({ initial, parentOrigin }: { initial: PreviewConfig; parentOrigin: string | undefined }) {
	const [config, setConfig] = useState(initial)

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

const params = new URLSearchParams(window.location.search)
const rootElement = document.querySelector("#talqo-widget")

if (!(rootElement instanceof HTMLElement)) {
	throw new Error("Root element not found")
}

createRoot(rootElement).render(
	<PreviewWidget
		initial={{
			appearance: appearanceFromSearch(params),
			title: params.get("title") ?? undefined,
			forcedScheme: forcedSchemeFromSearch(params),
		}}
		parentOrigin={trustedParentOrigin(params.get("parentOrigin"))}
	/>,
)
