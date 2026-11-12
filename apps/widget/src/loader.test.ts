import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { readFileSync } from "node:fs"

await import("./test-setup")

type FakeChat = { mount: (target: HTMLElement, boot: unknown) => void; unmount: () => void }
type MountOptions = { createClient?: () => unknown }

const loaderCode = readFileSync(new URL("../dist/widget.js", import.meta.url), "utf8")

function globals() {
	return window as {
		TalqoWidget?: { mount: (target?: string, options?: MountOptions) => void; unmount: () => void }
		TalqoWidgetChat?: FakeChat
	}
}

function fakeClient(appearance: Record<string, unknown> = { theme: "light", position: "bottom-right" }) {
	const snapshot = {
		isAvailable: true,
		configuration: { appearance, title: "Test" },
	}
	return {
		getSnapshot: () => snapshot,
		subscribe: () => () => {},
		initialize: async () => {},
		dispose: () => {},
	}
}

function fakeChat(calls: { mounts: number; unmounts: number }): FakeChat {
	return {
		mount: () => {
			calls.mounts += 1
		},
		unmount: () => {
			calls.unmounts += 1
		},
	}
}

function appendEmbedScript(): HTMLScriptElement {
	const script = document.createElement("script")
	script.type = "application/json"
	script.src = "https://cdn.example.com/widget.js"
	script.dataset.talqoEmbedToken = "token"
	script.dataset.talqoApi = "https://api.example.com"
	document.head.append(script)
	return script
}

async function flush() {
	await Bun.sleep(0)
}

let injected: HTMLScriptElement[] = []

function mountFake(client: () => unknown = () => fakeClient()) {
	globals().TalqoWidget?.unmount()
	globals().TalqoWidget?.mount(undefined, { createClient: client })
	const launcher = document.querySelector<HTMLButtonElement>(".talqo-widget-loader")
	if (!launcher) throw new Error("launcher not rendered")
	return launcher
}

function boot(client: () => unknown = () => fakeClient()) {
	appendEmbedScript()
	const run = new Function(loaderCode) as unknown as () => unknown
	run()
	return mountFake(client)
}

function resolveChat(module: FakeChat, script = injected.at(-1)) {
	if (!script) throw new Error("chat script not injected")
	globals().TalqoWidgetChat = module
	script.dispatchEvent(new Event("load"))
}

describe("widget loader", () => {
	let fetchSpy: { mockRestore: () => void }
	let originalAppend: typeof document.head.append

	beforeEach(() => {
		globals().TalqoWidget?.unmount()
		document.querySelector("#talqo-widget")?.remove()
		document.querySelectorAll("script[data-talqo-embed-token]").forEach((script) => script.remove())
		Reflect.deleteProperty(window, "TalqoWidgetChat")
		fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ name: "Test", appearance: {}, isAvailable: true })),
		)
		injected = []
		originalAppend = document.head.append.bind(document.head)
		document.head.append = (...nodes: (Node | string)[]) => {
			for (const node of nodes) {
				if (node instanceof HTMLScriptElement && node.src.includes("widget-chat.js")) {
					injected.push(node)
				} else {
					originalAppend(node)
				}
			}
		}
	})

	afterEach(() => {
		globals().TalqoWidget?.unmount()
		document.head.append = originalAppend
		fetchSpy.mockRestore()
	})

	test("prefetches the chat bundle on hover and copies the embed nonce", () => {
		const launcher = boot()
		const embed = document.querySelector<HTMLScriptElement>("script[data-talqo-embed-token]")
		if (!embed) throw new Error("embed script missing")
		embed.nonce = "abc123"

		launcher.dispatchEvent(new Event("pointerenter"))
		const script = injected.at(-1)

		expect(script?.src).toBe("https://cdn.example.com/widget-chat.js")
		expect(script?.nonce).toBe("abc123")
		expect(launcher.dataset.loading).toBe("false")
	})

	test("mounts the chat on click and tears it down after a remount", async () => {
		const calls = { mounts: 0, unmounts: 0 }
		const chat = fakeChat(calls)
		let launcher = boot()

		launcher.click()
		resolveChat(chat)
		await flush()
		expect(calls.mounts).toBe(1)

		globals().TalqoWidget?.unmount()
		expect(calls.unmounts).toBe(1)

		launcher = mountFake()
		launcher.click()
		await flush()
		expect(calls.mounts).toBe(2)

		globals().TalqoWidget?.unmount()
		expect(calls.unmounts).toBe(2)
	})

	test("retries the chat bundle after a failed load", async () => {
		const calls = { mounts: 0, unmounts: 0 }
		const chat = fakeChat(calls)
		const launcher = boot()

		launcher.click()
		injected.at(-1)?.dispatchEvent(new Event("error"))
		await flush()
		expect(launcher.dataset.error).toBe("true")
		expect(calls.mounts).toBe(0)

		launcher.click()
		resolveChat(chat)
		await flush()
		expect(injected).toHaveLength(2)
		expect(calls.mounts).toBe(1)
	})

	test("shows the error launcher when the chat fails to mount", async () => {
		const launcher = boot()

		launcher.click()
		resolveChat({
			mount: () => {
				throw new Error("boom")
			},
			unmount: () => {},
		})
		await flush()

		const errorLauncher = document.querySelector<HTMLButtonElement>(".talqo-widget-loader")
		expect(errorLauncher?.dataset.error).toBe("true")
	})

	test("repaints the launcher when the system scheme changes", () => {
		const listeners: Array<() => void> = []
		let dark = false
		const media = {
			get matches() {
				return dark
			},
			media: "(prefers-color-scheme: dark)",
			addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
			removeEventListener: () => {},
		} as unknown as MediaQueryList
		const originalMatchMedia = globalThis.matchMedia
		globalThis.matchMedia = () => media

		try {
			const launcher = boot(() =>
				fakeClient({
					theme: "system",
					position: "bottom-right",
					light: { primary: "#111111", textOnPrimary: "#ffffff" },
					dark: { primary: "#222222", textOnPrimary: "#ffffff" },
				}),
			)
			const lightBackground = launcher.style.background

			dark = true
			listeners.forEach((listener) => listener())

			expect(launcher.style.background).not.toBe(lightBackground)
		} finally {
			globalThis.matchMedia = originalMatchMedia
		}
	})
})
