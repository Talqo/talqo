import { createRoot, type Root } from "react-dom/client"

import { EmbeddedWidget, type EmbeddedWidgetProps, type WidgetPosition, type WidgetTheme } from "./embedded-widget"
import { isWidgetLanguage } from "./lib/i18n"

let root: Root | null = null

export type MountTarget = string | HTMLElement

const DEFAULT_TARGET = "#talqo-widget"

// Reads the snippet's data-talqo-* attributes. currentScript is null for
// defer/async or dynamic loads, so fall back to a lookup (single-widget pages).
function embedScriptDataset(): DOMStringMap | undefined {
	if (document.currentScript instanceof HTMLScriptElement) {
		return document.currentScript.dataset
	}
	return document.querySelector<HTMLScriptElement>("script[data-talqo-agent]")?.dataset
}

function embedProps(): EmbeddedWidgetProps {
	const dataset = embedScriptDataset()
	if (!dataset) {
		return {}
	}
	const { talqoAgent, talqoLanguage, talqoTitle, talqoTheme, talqoAccent, talqoPosition } = dataset
	return {
		agentId: talqoAgent,
		language: isWidgetLanguage(talqoLanguage) ? talqoLanguage : undefined,
		title: talqoTitle,
		theme: talqoTheme === "light" || talqoTheme === "dark" ? (talqoTheme as WidgetTheme) : undefined,
		accent: talqoAccent,
		position:
			talqoPosition === "bottom-left" || talqoPosition === "bottom-right"
				? (talqoPosition as WidgetPosition)
				: undefined,
	}
}

// The snippet carries no mount element, so the default path creates its own
// root. An explicit target must exist — a missing one is a host-page error.
function resolveMountElement(target: MountTarget): HTMLElement | null {
	const element = typeof target === "string" ? document.querySelector(target) : target
	if (element instanceof HTMLElement || target !== DEFAULT_TARGET) {
		return element instanceof HTMLElement ? element : null
	}
	const created = document.createElement("div")
	created.id = DEFAULT_TARGET.slice(1)
	document.body.append(created)
	return created
}

export function mount(target: MountTarget = DEFAULT_TARGET) {
	unmount()

	const element = resolveMountElement(target)
	if (!element) {
		console.warn(`TalqoWidget: mount target not found (${typeof target === "string" ? target : "element"})`)
		return
	}

	root = createRoot(element)
	root.render(<EmbeddedWidget {...embedProps()} />)
}

export function unmount() {
	if (root) {
		root.unmount()
		root = null
	}
}

const globalScope = window as { TalqoWidget?: { mount: typeof mount; unmount: typeof unmount } }
globalScope.TalqoWidget = { mount, unmount }

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => mount())
} else {
	mount()
}
