import type { WidgetAppearance, WidgetAppearanceInput, WidgetScheme } from "@talqo/shared/widget-appearance"

import { type ChatClient, type ChatClientOptions, createChatClient } from "@talqo/sdk"
import logoUrl from "@talqo/ui/assets/logo.svg"

import { activeScheme, resolveAppearance } from "./lib/appearance"
import { type ChatBoot, type ChatModule, widgetGlobals } from "./lib/chat-bridge"
import { apiOrigin, appearanceFromDataset, mergeAppearance } from "./lib/embed-config"
import { launcherText } from "./lib/launcher-text"

import "./launcher.css"

export type MountTarget = string | HTMLElement
export type ChatClientFactory = (options: Pick<ChatClientOptions, "apiUrl" | "embedToken">) => ChatClient
export type MountOptions = { createClient?: ChatClientFactory }

const DEFAULT_TARGET = "#talqo-widget"
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)"
const CHAT_SCRIPT_NAME = "widget-chat.js"

/** Captured at module scope: `document.currentScript` is null once `mount()` runs. */
const embedScript: HTMLScriptElement | null =
	document.currentScript instanceof HTMLScriptElement ? document.currentScript : findEmbedScript()

let client: ChatClient | null = null
let unsubscribe: (() => void) | null = null
let container: HTMLElement | null = null
let launcher: HTMLButtonElement | null = null
let chatModule: ChatModule | null = null
let chatPromise: Promise<ChatModule> | null = null
let chatBoot: ChatBoot | null = null
let appearanceOverrides: WidgetAppearanceInput = {}
let datasetTitle: string | undefined
let mediaQuery: MediaQueryList | null = null
let mediaListener: (() => void) | null = null
let lastLauncherKey = ""
let generation = 0
let loading = false
let loadFailed = false
let handedOff = false

function findEmbedScript(): HTMLScriptElement | null {
	const scripts = document.querySelectorAll<HTMLScriptElement>(
		"script[data-talqo-embed-token], script[data-talqo-preview]",
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

function prefersDark(): boolean {
	return globalThis.matchMedia?.(DARK_SCHEME_QUERY)?.matches ?? false
}

function attachMediaListener() {
	const media = globalThis.matchMedia?.(DARK_SCHEME_QUERY)
	if (!media) return
	mediaQuery = media
	mediaListener = () => syncLauncher()
	media.addEventListener("change", mediaListener)
}

function detachMediaListener() {
	if (mediaQuery && mediaListener) {
		mediaQuery.removeEventListener("change", mediaListener)
	}
	mediaQuery = null
	mediaListener = null
}

function ensureLauncher(): HTMLButtonElement {
	if (launcher) return launcher

	const button = document.createElement("button")
	button.type = "button"
	button.className = "talqo-widget-loader"
	button.setAttribute("aria-haspopup", "dialog")
	button.setAttribute("aria-expanded", "false")

	const mark = document.createElement("span")
	mark.className = "talqo-widget-loader-mark"
	mark.setAttribute("aria-hidden", "true")
	button.append(mark)

	button.addEventListener("click", () => {
		void openChat()
	})
	for (const event of ["pointerenter", "focus", "touchstart"] as const) {
		button.addEventListener(event, prefetchChat, { once: true })
	}

	container?.append(button)
	launcher = button
	return button
}

function applyLauncher(button: HTMLButtonElement, appearance: WidgetAppearance, scheme: WidgetScheme) {
	const text = launcherText(appearance.language)
	button.style.background = scheme.primary
	button.style.color = scheme.textOnPrimary
	button.style.right = appearance.position === "bottom-right" ? "1rem" : "auto"
	button.style.left = appearance.position === "bottom-left" ? "1rem" : "auto"
	button.lang = appearance.language
	button.dataset.loading = loading ? "true" : "false"
	button.dataset.error = loadFailed ? "true" : "false"
	button.setAttribute("aria-busy", loading ? "true" : "false")
	button.setAttribute("aria-label", loadFailed ? text.errorTransport : text.openChat)
	button.title = loadFailed ? text.errorTransport : ""
	button.style.setProperty("--talqo-loader-logo", `url("${logoUrl}")`)
}

function removeLauncher() {
	launcher?.remove()
	launcher = null
	lastLauncherKey = ""
}

function syncLauncher() {
	if (!container || handedOff || !client) return
	const snapshot = client.getSnapshot()
	if (!snapshot.isAvailable) {
		removeLauncher()
		return
	}

	const configured = (snapshot.configuration?.appearance ?? {}) as WidgetAppearanceInput
	const appearance = resolveAppearance(mergeAppearance(configured, appearanceOverrides))
	const scheme = activeScheme(appearance, prefersDark())
	const key = JSON.stringify({ appearance, scheme, loading, loadFailed })
	if (launcher && key === lastLauncherKey) return

	lastLauncherKey = key
	const button = ensureLauncher()
	applyLauncher(button, appearance, scheme)
	chatBoot = { mode: "connected", client, appearance, title: datasetTitle }
}

function chatScriptUrl(): string | undefined {
	const source = embedScript?.src
	if (!source) return undefined
	try {
		const scriptUrl = new URL(source)
		const next = new URL(CHAT_SCRIPT_NAME, scriptUrl)
		next.search = scriptUrl.search
		return next.toString()
	} catch {
		return undefined
	}
}

function loadChat(): Promise<ChatModule> {
	const devChat = widgetGlobals().talqoDevChat
	if (devChat) return Promise.resolve(rememberChat(devChat))
	if (chatModule) return Promise.resolve(chatModule)
	if (chatPromise) return chatPromise.then(rememberChat)

	const pending = new Promise<ChatModule>((resolve, reject) => {
		const source = chatScriptUrl()
		if (!source) {
			reject(new Error("chat script URL unavailable"))
			return
		}
		const script = document.createElement("script")
		script.src = source
		script.async = true
		if (embedScript?.nonce) script.nonce = embedScript.nonce
		script.addEventListener(
			"load",
			() => {
				const installed = widgetGlobals().TalqoWidgetChat
				if (installed) resolve(rememberChat(installed))
				else reject(new Error("chat bundle did not initialize"))
			},
			{ once: true },
		)
		script.addEventListener("error", () => reject(new Error(`failed to load ${source}`)), { once: true })
		document.head.append(script)
	})

	chatPromise = pending
	void pending.catch(() => {
		if (chatPromise === pending) chatPromise = null
	})
	return pending
}

function rememberChat(module: ChatModule): ChatModule {
	chatModule = module
	return module
}

function prefetchChat() {
	void loadChat().catch(() => {})
}

async function openChat() {
	const boot = chatBoot
	if (!container || !boot || loading || handedOff) return

	const current = generation
	loading = true
	loadFailed = false
	syncLauncher()

	try {
		const module = await loadChat()
		if (current !== generation || !container) return
		loading = false
		removeLauncher()
		module.mount(container, boot)
		handedOff = true
		unsubscribe?.()
		unsubscribe = null
		detachMediaListener()
	} catch (cause) {
		if (current !== generation) return
		loading = false
		loadFailed = true
		console.warn("TalqoWidget: failed to load chat", cause)
		syncLauncher()
	}
}

export function mount(target: MountTarget = DEFAULT_TARGET, options: MountOptions = {}) {
	const element = resolveMountElement(target)
	if (!element) {
		console.warn(`TalqoWidget: mount target not found (${typeof target === "string" ? target : "element"})`)
		return
	}

	unmount()

	const dataset = embedScript?.dataset
	const nextContainer = document.createElement("div")
	nextContainer.dataset.talqoRoot = ""
	element.append(nextContainer)
	container = nextContainer

	if (dataset?.talqoPreview !== undefined) {
		const current = generation
		void loadChat()
			.then((module) => {
				if (current !== generation || !container) return
				module.mount(container, { mode: "preview", parentOrigin: dataset.talqoParentOrigin })
			})
			.catch((cause: unknown) => console.warn("TalqoWidget: failed to load chat", cause))
		return
	}

	const embedToken = dataset?.talqoEmbedToken
	const origin = apiOrigin(embedScript)
	if (!embedToken || !origin) {
		nextContainer.remove()
		container = null
		console.warn("TalqoWidget: embed token or API origin missing")
		return
	}

	appearanceOverrides = appearanceFromDataset(dataset)
	datasetTitle = dataset?.talqoTitle
	client = (options.createClient ?? createChatClient)({ apiUrl: origin, embedToken })
	unsubscribe = client.subscribe(syncLauncher)
	attachMediaListener()
	syncLauncher()
	void client.initialize().catch((cause: unknown) => console.warn("TalqoWidget: initialization failed", cause))
}

export function unmount() {
	generation += 1
	unsubscribe?.()
	unsubscribe = null
	detachMediaListener()
	chatModule?.unmount()
	chatModule = null
	client?.dispose()
	client = null
	container?.remove()
	container = null
	launcher = null
	chatBoot = null
	appearanceOverrides = {}
	datasetTitle = undefined
	lastLauncherKey = ""
	loading = false
	loadFailed = false
	handedOff = false
}

const globalScope = window as { TalqoWidget?: { mount: typeof mount; unmount: typeof unmount } }
globalScope.TalqoWidget = { mount, unmount }

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => mount())
} else {
	mount()
}
