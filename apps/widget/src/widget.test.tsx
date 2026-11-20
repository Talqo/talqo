import type { ChatClient, ChatSnapshot } from "@talqo/sdk"

import { readyMessage } from "@talqo/shared/preview-channel"
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"

import type { ChatBoot, ChatModule } from "./lib/chat-bridge"
import type { MountOptions, MountTarget } from "./widget"

// Import paused: with a parsed document the module auto-mounts at import, outside any test,
// so a broken mount surfaces as an unhandled error between tests instead of a failed test.
const { mount, unmount } = await import("./test-setup").then(async () => {
	// Earlier test files in the same process can leave snippets that the widget captures at import.
	document
		.querySelectorAll("script[data-talqo-embed-token], script[data-talqo-preview]")
		.forEach((element) => element.remove())
	const parsedState = Object.getOwnPropertyDescriptor(document, "readyState")
	Object.defineProperty(document, "readyState", { configurable: true, value: "loading" })
	try {
		return await import("./widget")
	} finally {
		if (parsedState) Object.defineProperty(document, "readyState", parsedState)
		else Reflect.deleteProperty(document, "readyState")
	}
})
const { act } = await import("react")

describe("widget mount", () => {
	beforeEach(() => {
		unmount()
		document.querySelector("#talqo-widget")?.remove()
	})

	// The last mount would otherwise keep its React root and listeners alive for
	// every test file that runs later in the same process.
	afterEach(() => {
		unmount()
		document.querySelector("#talqo-widget")?.remove()
	})

	test("creates its own mount root when the page has none", () => {
		expect(document.querySelector("#talqo-widget")).toBeNull()
		mount()
		const element = document.querySelector("#talqo-widget")
		expect(element).not.toBeNull()
		expect(element?.parentElement).toBe(document.body)
	})

	test("mounts into an existing target element", () => {
		const element = document.createElement("div")
		element.id = "talqo-widget"
		document.body.append(element)
		mount()
		expect(document.querySelector("#talqo-widget")).toBe(element)
	})

	test("warns and creates nothing for a missing explicit target", () => {
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		mount("#missing-target")
		expect(document.querySelector("#talqo-widget")).toBeNull()
		expect(warning).toHaveBeenCalledWith("TalqoWidget: mount target not found (#missing-target)")
	})

	test("warns instead of throwing for an invalid selector target", () => {
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		expect(() => mount("#")).not.toThrow()
		expect(document.querySelector("#talqo-widget")).toBeNull()
		expect(warning).toHaveBeenCalledWith("TalqoWidget: mount target not found (#)")
	})

	test("reports an element target that cannot host the widget", () => {
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		mount(document as unknown as HTMLElement)
		expect(warning).toHaveBeenCalledWith("TalqoWidget: mount target not found (element)")
	})

	test("warns and renders no widget without an embed token", () => {
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		mount()
		expect(document.querySelector("#talqo-widget")?.childElementCount).toBe(0)
		expect(warning).toHaveBeenCalledWith("TalqoWidget: embed token or API origin missing")
	})

	test("does not reach the network without a widget token", () => {
		using fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch"))

		mount()

		expect(fetchSpy).not.toHaveBeenCalled()
	})
})

type WidgetModule = {
	mount: (target?: MountTarget, options?: MountOptions) => void
	unmount: () => void
}

function snippet(attributes: Record<string, string>): void {
	const element = document.createElement("script")
	for (const [name, value] of Object.entries(attributes)) {
		element.setAttribute(name, value)
	}
	document.head.append(element)
}

function fakeClient(): ChatClient {
	const snapshot: ChatSnapshot = {
		isAvailable: true,
		configuration: undefined,
		messages: [],
		activity: "idle",
		actions: [],
		notices: [],
		acceptedMessageId: undefined,
		activeTools: [],
		error: undefined,
	}
	return {
		subscribe: () => () => {},
		getSnapshot: () => snapshot,
		initialize: async () => {},
		sendMessage: async () => {},
		retryLastMessage: async () => {},
		cancelResponse: async () => {},
		startNewChat: async () => {},
		dispose: () => {},
	}
}

function replaceChat(module: ChatModule | undefined): void {
	const scope = window as { talqoDevChat?: ChatModule }
	if (module) scope.talqoDevChat = module
	else Reflect.deleteProperty(scope, "talqoDevChat")
}

function fakeChat(): {
	module: ChatModule
	mounts: Array<{ target: HTMLElement; boot: ChatBoot }>
	unmounts: () => number
} {
	const mounts: Array<{ target: HTMLElement; boot: ChatBoot }> = []
	let unmounts = 0
	return {
		mounts,
		unmounts: () => unmounts,
		module: {
			mount(target, boot) {
				mounts.push({ target, boot })
				if (boot.mode === "preview" && boot.parentOrigin) {
					window.parent.postMessage(readyMessage(), boot.parentOrigin)
				}
				const root = document.createElement("div")
				root.className = "talqo-widget"
				target.append(root)
			},
			unmount() {
				unmounts += 1
			},
		},
	}
}

function importWidget(scenario: string): Promise<WidgetModule> {
	return import(`./widget.ts?${scenario}`) as Promise<WidgetModule>
}

async function importWidgetPaused(
	scenario: string,
	listeners?: Array<{ type: string; listener: EventListener }>,
): Promise<WidgetModule> {
	const ownReadyState = Object.getOwnPropertyDescriptor(document, "readyState")
	const addListener = spyOn(document, "addEventListener").mockImplementation(((
		type: string,
		listener: EventListener,
	) => {
		listeners?.push({ type, listener })
	}) as typeof document.addEventListener)
	Object.defineProperty(document, "readyState", { value: "loading", configurable: true })
	try {
		return await importWidget(scenario)
	} finally {
		addListener.mockRestore()
		if (ownReadyState) Object.defineProperty(document, "readyState", ownReadyState)
		else Reflect.deleteProperty(document, "readyState")
	}
}

describe("embed snippet discovery", () => {
	let widget: WidgetModule | undefined

	beforeEach(async () => {
		;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
		await act(async () => unmount())
		document.querySelector("#talqo-widget")?.remove()
		replaceChat(undefined)
	})

	afterEach(async () => {
		await act(async () => widget?.unmount())
		widget = undefined
		;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false
		document.querySelector("#talqo-widget")?.remove()
		document.querySelectorAll("script[data-talqo-embed-token], script[data-talqo-preview]").forEach((element) => {
			element.remove()
		})
		replaceChat(undefined)
	})

	test("defers its mount until the document is parsed", async () => {
		snippet({ "data-talqo-preview": "", "data-talqo-parent-origin": "https://dashboard.example.com" })
		using postMessage = spyOn(window.parent, "postMessage").mockImplementation(() => {})
		replaceChat(fakeChat().module)
		const listeners: Array<{ type: string; listener: EventListener }> = []

		widget = await importWidgetPaused("deferred-mount", listeners)
		const onParsed = listeners.find((entry) => entry.type === "DOMContentLoaded")?.listener
		expect(onParsed).toBeDefined()
		expect(document.querySelector("#talqo-widget")).toBeNull()

		await act(async () => onParsed?.({} as Event))

		expect(document.querySelector("#talqo-widget")).not.toBeNull()
		expect(postMessage).toHaveBeenCalledWith(readyMessage(), "https://dashboard.example.com")
	})

	test("renders the preview harness for a preview snippet", async () => {
		snippet({ "data-talqo-preview": "", "data-talqo-parent-origin": "https://dashboard.example.com" })
		using postMessage = spyOn(window.parent, "postMessage").mockImplementation(() => {})
		const chat = fakeChat()
		replaceChat(chat.module)

		widget = await importWidgetPaused("preview-snippet")
		await act(async () => widget?.mount())

		expect(postMessage).toHaveBeenCalledWith(readyMessage(), "https://dashboard.example.com")
		expect(chat.mounts).toHaveLength(1)
		expect(chat.mounts[0]?.boot).toEqual({ mode: "preview", parentOrigin: "https://dashboard.example.com" })
	})

	test("mounts the connected widget from the snippet with an injected client", async () => {
		snippet({
			"data-talqo-embed-token": "token-1",
			"data-talqo-api": "https://api.example.com",
			"data-talqo-title": "Support",
		})
		using fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected fetch"))
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		const calls: Array<{ apiUrl: string; embedToken: string; pageControl?: { exclude?: readonly Element[] } }> = []
		const client = fakeClient()
		const chat = fakeChat()
		replaceChat(chat.module)

		widget = await importWidgetPaused("connected-snippet")
		const target = document.createElement("div")
		document.body.append(target)
		await act(async () =>
			widget?.mount(target, {
				createClient(options) {
					calls.push(options)
					return client
				},
			}),
		)

		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({ apiUrl: "https://api.example.com", embedToken: "token-1" })
		expect(calls[0]?.pageControl?.exclude).toHaveLength(1)
		expect(target.querySelector(".talqo-widget-loader")).not.toBeNull()
		expect(chat.mounts).toHaveLength(0)
		expect(warning).not.toHaveBeenCalled()
		expect(fetchSpy).not.toHaveBeenCalled()

		await act(async () => target.querySelector<HTMLButtonElement>(".talqo-widget-loader")?.click())

		expect(chat.mounts).toHaveLength(1)
		expect(chat.mounts[0]?.boot).toMatchObject({ mode: "connected", client, title: "Support" })
		expect(target.querySelector(".talqo-widget")).not.toBeNull()
		expect(target.querySelector(".talqo-widget-loader")).toBeNull()

		await act(async () => widget?.unmount())
		expect(target.childElementCount).toBe(0)
		expect(chat.unmounts()).toBe(1)
		expect(() => widget?.unmount()).not.toThrow()
		target.remove()
	})

	test("warns and renders nothing when the snippet lacks an API origin", async () => {
		snippet({ "data-talqo-embed-token": "token-1" })
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		let created = 0

		widget = await importWidgetPaused("token-only-snippet")
		const target = document.createElement("div")
		document.body.append(target)
		await act(async () =>
			widget?.mount(target, {
				createClient() {
					created += 1
					return fakeClient()
				},
			}),
		)

		expect(warning).toHaveBeenCalledWith("TalqoWidget: embed token or API origin missing")
		expect(created).toBe(0)
		expect(target.querySelector(".talqo-widget")).toBeNull()
		target.remove()
	})

	test("warns about duplicate snippets and uses the first", async () => {
		snippet({ "data-talqo-embed-token": "first", "data-talqo-api": "https://api.example.com" })
		snippet({ "data-talqo-embed-token": "second", "data-talqo-api": "https://api.example.com" })
		using warning = spyOn(console, "warn").mockImplementation(() => {})
		const tokens: string[] = []

		widget = await importWidgetPaused("duplicate-snippets")
		await act(async () =>
			widget?.mount(document.createElement("div"), {
				createClient(options) {
					tokens.push(options.embedToken)
					return fakeClient()
				},
			}),
		)

		expect(warning).toHaveBeenCalledWith("TalqoWidget: multiple embed snippets found; using the first")
		expect(tokens).toEqual(["first"])
	})

	test("remounting replaces the previous widget root", async () => {
		snippet({ "data-talqo-embed-token": "token-1", "data-talqo-api": "https://api.example.com" })
		const client = fakeClient()
		const first = document.createElement("div")
		const second = document.createElement("div")
		document.body.append(first, second)

		widget = await importWidgetPaused("remount")
		await act(async () => widget?.mount(first, { createClient: () => client }))
		await act(async () => widget?.mount(second, { createClient: () => client }))

		expect(first.childElementCount).toBe(0)
		expect(second.querySelector(".talqo-widget-loader")).not.toBeNull()
		first.remove()
		second.remove()
	})
})
