import type { WidgetAppearanceInput } from "@talqo/shared/widget-appearance"

import { createRoot, type Root } from "react-dom/client"

import { EmbeddedWidget } from "./embedded-widget"
import { apiOrigin, appearanceFromDataset, configUrl, parseWidgetConfig } from "./lib/embed-config"

let root: Root | null = null

export type MountTarget = string | HTMLElement

const DEFAULT_TARGET = "#talqo-widget"

// Past this the widget paints with what it has rather than waiting on a slow API.
const CONFIG_TIMEOUT_MS = 1500

/** Module scope: `document.currentScript` is null by the time mount() runs. */
const embedScript: HTMLScriptElement | null =
	document.currentScript instanceof HTMLScriptElement ? document.currentScript : findEmbedScript()

function findEmbedScript(): HTMLScriptElement | null {
	const scripts = document.querySelectorAll<HTMLScriptElement>(
		"script[data-talqo-widget], script[data-talqo-embed-token]",
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
	if (element instanceof HTMLElement || target !== DEFAULT_TARGET) {
		return element instanceof HTMLElement ? element : null
	}
	const created = document.createElement("div")
	created.id = DEFAULT_TARGET.slice(1)
	document.body.append(created)
	return created
}

function render(appearance: WidgetAppearanceInput, agentId: string | undefined, hidden: boolean) {
	const dataset = embedScript?.dataset
	root?.render(<EmbeddedWidget title={dataset?.talqoTitle} agentId={agentId} appearance={appearance} hidden={hidden} />)
}

async function loadConfig(origin: string, publicToken: string, overrides: WidgetAppearanceInput): Promise<void> {
	try {
		const response = await fetch(configUrl(origin, publicToken), { signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS) })
		if (!response.ok) {
			throw new Error(`config request failed: ${response.status}`)
		}
		const { agentId, appearance } = parseWidgetConfig(await response.json())
		// Attributes last: an explicit per-page override outranks the stored config.
		render({ ...appearance, ...overrides }, agentId, false)
	} catch (error) {
		// A widget that cannot reach its config must still work, in default colors.
		console.warn("TalqoWidget: falling back to the default appearance", error)
		render(overrides, undefined, false)
	}
}

export function mount(target: MountTarget = DEFAULT_TARGET) {
	const element = resolveMountElement(target)
	if (!element) {
		console.warn(`TalqoWidget: mount target not found (${typeof target === "string" ? target : "element"})`)
		return
	}

	unmount()
	root = createRoot(element)

	const dataset = embedScript?.dataset
	const publicToken = dataset?.talqoWidget
	const origin = apiOrigin(embedScript)
	const overrides = appearanceFromDataset(dataset)

	// Agent-level `data-talqo-embed-token` snippets and the dev harness fetch nothing.
	if (!publicToken || !origin) {
		render(overrides, undefined, false)
		return
	}

	// Hidden rather than deferred: the box is reserved, and no default-color flash.
	render(overrides, undefined, true)
	void loadConfig(origin, publicToken, overrides)
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
