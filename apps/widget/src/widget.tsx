import { createRoot, type Root } from "react-dom/client"

import { EmbeddedWidget, type EmbeddedWidgetProps, type WidgetPosition, type WidgetTheme } from "./embedded-widget"
import { isWidgetLanguage } from "./lib/i18n"

let root: Root | null = null

export type MountTarget = string | HTMLElement

const DEFAULT_TARGET = "#talqo-widget"

// Float in the corner by default; embeds can pin it via data-talqo-position.
const DEFAULT_POSITION: WidgetPosition = "bottom-right"

function embedScriptDataset(): DOMStringMap | undefined {
	if (document.currentScript instanceof HTMLScriptElement) {
		return document.currentScript.dataset
	}
	const scripts = document.querySelectorAll<HTMLScriptElement>("script[data-talqo-embed-token]")
	if (scripts.length > 1) {
		console.warn("TalqoWidget: multiple embed snippets found; using the first")
	}
	return scripts[0]?.dataset
}

function embedProps(): EmbeddedWidgetProps {
	const dataset = embedScriptDataset()
	if (!dataset) {
		return { position: DEFAULT_POSITION }
	}
	const { talqoEmbedToken, talqoLanguage, talqoTitle, talqoTheme, talqoAccent, talqoPosition } = dataset
	return {
		embedToken: talqoEmbedToken,
		language: isWidgetLanguage(talqoLanguage) ? talqoLanguage : undefined,
		title: talqoTitle,
		theme: talqoTheme === "light" || talqoTheme === "dark" ? (talqoTheme as WidgetTheme) : undefined,
		accent: talqoAccent,
		position:
			talqoPosition === "bottom-left" || talqoPosition === "bottom-right"
				? (talqoPosition as WidgetPosition)
				: DEFAULT_POSITION,
	}
}

function resolveMountElement(target: MountTarget): HTMLElement | null {
	let element: Element | MountTarget | null
	try {
		element = typeof target === "string" ? document.querySelector(target) : target
	} catch {
		element = null
	}
	if (element instanceof HTMLElement || target !== DEFAULT_TARGET) {
		return element instanceof HTMLElement ? element : null
	}
	const created = document.createElement("div")
	created.id = DEFAULT_TARGET.slice(1)
	document.body.append(created)
	return created
}

export function mount(target: MountTarget = DEFAULT_TARGET) {
	const element = resolveMountElement(target)
	if (!element) {
		console.warn(`TalqoWidget: mount target not found (${typeof target === "string" ? target : "element"})`)
		return
	}

	unmount()
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
