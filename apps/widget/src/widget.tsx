import { createRoot, type Root } from "react-dom/client"

import { EmbeddedWidget, type EmbeddedWidgetProps, type WidgetPosition, type WidgetTheme } from "./embedded-widget"
import { isWidgetLanguage } from "./lib/i18n"

let root: Root | null = null

export type MountTarget = string | HTMLElement

const DEFAULT_TARGET = "#talqo-widget"

// Reads the embed snippet's configuration, e.g.
// <script src=".../widget.js" data-talqo-agent="..." data-talqo-language="cs"></script>.
// currentScript is null when a host page adds defer/async or loads the bundle
// dynamically, so fall back to a lookup (single-widget pages only).
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

// The pasted snippet carries no mount element, so the default embed path
// creates its own root. An explicit target must still exist — a missing one
// is a host-page error, not something to paper over.
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

declare global {
	// eslint-disable-next-line typescript/consistent-type-definitions -- window augmentation requires interface merging.
	interface Window {
		TalqoWidget?: {
			mount: typeof mount
			unmount: typeof unmount
		}
	}
}

window.TalqoWidget = { mount, unmount }

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => mount())
} else {
	mount()
}
