import type { WidgetAppearanceInput } from "@talqo/shared/widget-appearance"

import { createChatClient, type ChatClient, type ChatClientOptions } from "@talqo/sdk"
import { createRoot, type Root } from "react-dom/client"

import { ConnectedEmbeddedWidget, EmbeddedWidget } from "./embedded-widget"
import { apiOrigin, appearanceFromDataset } from "./lib/embed-config"
import { PreviewWidget } from "./preview"

let root: Root | null = null

export type MountTarget = string | HTMLElement
export type ChatClientFactory = (options: Pick<ChatClientOptions, "apiUrl" | "embedToken">) => ChatClient
export type MountOptions = { createClient?: ChatClientFactory }

const DEFAULT_TARGET = "#talqo-widget"

/** Module scope: `document.currentScript` is null by the time mount() runs. */
const embedScript: HTMLScriptElement | null =
	document.currentScript instanceof HTMLScriptElement ? document.currentScript : findEmbedScript()

function findEmbedScript(): HTMLScriptElement | null {
	const scripts = document.querySelectorAll<HTMLScriptElement>(
		"script[data-talqo-widget], script[data-talqo-embed-token], script[data-talqo-preview]",
	)
	if (scripts.length > 1) {
		console.warn("TalqoWidget: multiple embed snippets found; using the first")
	}
	return scripts[0] ?? null
}

function resolveMountElement(target: MountTarget): HTMLElement | null {
	let element: Element | MountTarget | null
	try {
		element = typeof target === "string" ? document.querySelector(target) : target
	} catch {
		element = null
	}
	if (element instanceof HTMLElement) return element
	if (target !== DEFAULT_TARGET) return null
	const created = document.createElement("div")
	created.id = DEFAULT_TARGET.slice(1)
	document.body.append(created)
	return created
}

function renderUnavailable(appearance: WidgetAppearanceInput) {
	const dataset = embedScript?.dataset
	root?.render(<EmbeddedWidget title={dataset?.talqoTitle} appearance={appearance} unavailable />)
}

export function mount(target: MountTarget = DEFAULT_TARGET, options: MountOptions = {}) {
	const element = resolveMountElement(target)
	if (!element) {
		console.warn(`TalqoWidget: mount target not found (${typeof target === "string" ? target : "element"})`)
		return
	}

	unmount()
	root = createRoot(element)

	const dataset = embedScript?.dataset
	if (dataset?.talqoPreview !== undefined) {
		root.render(<PreviewWidget />)
		return
	}
	const embedToken = dataset?.talqoEmbedToken ?? dataset?.talqoWidget
	const origin = apiOrigin(embedScript)
	const overrides = appearanceFromDataset(dataset)

	if (!embedToken || !origin) {
		renderUnavailable(overrides)
		return
	}

	const client = (options.createClient ?? createChatClient)({ apiUrl: origin, embedToken })
	root.render(<ConnectedEmbeddedWidget client={client} title={dataset?.talqoTitle} appearance={overrides} />)
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
