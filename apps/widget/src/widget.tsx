import { createRoot, type Root } from "react-dom/client"

import { EmbeddedWidget, type EmbeddedWidgetProps, type WidgetTheme } from "./embedded-widget"
import { isWidgetLanguage } from "./lib/i18n"

let root: Root | null = null

export type MountTarget = string | HTMLElement

// Reads the embed snippet's configuration, e.g.
// <script src=".../widget.js" data-talqo-bot="..." data-talqo-language="cs"></script>.
// currentScript is null when a host page adds defer/async or loads the bundle
// dynamically, so fall back to a lookup (single-widget pages only).
function embedScriptDataset(): DOMStringMap | undefined {
	if (document.currentScript instanceof HTMLScriptElement) {
		return document.currentScript.dataset
	}
	return document.querySelector<HTMLScriptElement>("script[data-talqo-bot]")?.dataset
}

function embedProps(): EmbeddedWidgetProps {
	const dataset = embedScriptDataset()
	if (!dataset) {
		return {}
	}
	const { talqoBot, talqoLanguage, talqoTitle, talqoTheme } = dataset
	return {
		botId: talqoBot,
		language: isWidgetLanguage(talqoLanguage) ? talqoLanguage : undefined,
		title: talqoTitle,
		theme: talqoTheme === "light" || talqoTheme === "dark" ? (talqoTheme as WidgetTheme) : undefined,
	}
}

export function mount(target: MountTarget = "#talqo-widget") {
	unmount()

	const element = typeof target === "string" ? document.querySelector(target) : target
	if (!(element instanceof HTMLElement)) {
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
