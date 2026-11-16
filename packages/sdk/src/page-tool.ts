import type { BrowserState, PageController } from "@page-agent/page-controller"
import type { Tool } from "ai"

import { tool } from "ai"
import { z } from "zod"

export const PAGE_TOOL_NAME = "talqo_page"
const DESCRIPTION_LIMIT = 300
const APPROVAL_LIMIT = 2000
const INPUT_LIMIT = 10_000
const OPTION_LIMIT = 1000
const CENTER_DIVISOR = 2

const target = {
	snapshot: z.string().describe("Required for click, fill, and select. Copy the latest observation's snapshot."),
	index: z.number().int().nonnegative(),
	description: z.string().min(1).max(DESCRIPTION_LIMIT),
	approval: z
		.string()
		.min(1)
		.max(APPROVAL_LIMIT)
		.nullable()
		.default(null)
		.describe(
			"For a consequential action, put the exact proposal here. The tool shows approval buttons and waits. Otherwise null.",
		),
}
const actionSchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("observe") }),
	z.object({ action: z.literal("click"), ...target }),
	z.object({ action: z.literal("fill"), ...target, text: z.string().max(INPUT_LIMIT) }),
	z.object({ action: z.literal("select"), ...target, option: z.string().max(OPTION_LIMIT) }),
	z.object({ action: z.literal("scroll"), down: z.boolean(), description: z.string().max(DESCRIPTION_LIMIT) }),
])
const inputSchema = z.object({
	action: z.enum(["observe", "click", "fill", "select", "scroll"]),
	...z.object(target).partial().shape,
	text: z.string().max(INPUT_LIMIT).optional(),
	option: z.string().max(OPTION_LIMIT).optional(),
	down: z.boolean().optional(),
})

const labels = {
	en: {
		approve: "Approve",
		cancel: "Cancel",
		stop: "Stop",
		observing: "Reading this page",
		stopped: "Could not stop the agent. Try Stop in chat.",
	},
	cs: {
		approve: "Schválit",
		cancel: "Zrušit",
		stop: "Zastavit",
		observing: "Čtu tuto stránku",
		stopped: "Agenta se nepodařilo zastavit. Zkuste Zastavit v chatu.",
	},
}

async function browserState(page: PageController): Promise<BrowserState> {
	const state = await page.getBrowserState()
	return { ...state, content: state.content.replace(/\*\[(\d+)\]/g, "[$1]") }
}

export function createPageTool(options: { exclude: readonly Element[]; language: string; stop(): Promise<void> }): {
	dispose(): void
	definition: Tool<z.infer<typeof inputSchema>, unknown>
} {
	let controller: PageController | undefined
	let panel: HTMLElement | undefined
	let status: HTMLElement | undefined
	let buttons: HTMLElement | undefined
	let highlight: HTMLElement | undefined
	let snapshot: { id: string; content: string; url: string } | undefined
	let busy = false
	let modalDialogs: HTMLDialogElement[] = []
	let validateAction: ((element: HTMLElement) => Promise<void>) | undefined
	let activeSignal: AbortSignal | undefined
	let stopping = new AbortController()
	let taskSignal = stopping.signal
	const text = options.language === "cs" ? labels.cs : labels.en

	function dispose() {
		stopping.abort(new Error("Page task ended"))
		controller?.dispose()
		controller = undefined
		panel?.remove()
		panel = undefined
		highlight?.remove()
		highlight = undefined
		status = undefined
		buttons = undefined
		snapshot = undefined
		validateAction = undefined
		for (const dialog of modalDialogs) {
			if (dialog.isConnected && dialog.open && !dialog.matches(":modal")) {
				dialog.close()
				dialog.showModal()
			}
		}
		modalDialogs = []
	}

	function releaseChatDialogs(): void {
		// A modal chat makes the host page and approval controls inert.
		for (const root of options.exclude) {
			const dialogs = [...root.querySelectorAll<HTMLDialogElement>("dialog:modal")]
			if (root instanceof HTMLDialogElement && root.matches(":modal")) dialogs.push(root)
			for (const dialog of dialogs) {
				if (!modalDialogs.includes(dialog)) modalDialogs.push(dialog)
				dialog.close()
				dialog.show()
			}
		}
	}

	function placePanel(element: HTMLElement): void {
		if (!panel) return
		panel.style.top = "16px"
		panel.style.bottom = "auto"
		const targetRect = element.getBoundingClientRect()
		const panelRect = panel.getBoundingClientRect()
		if (targetRect.right > panelRect.left && targetRect.top < panelRect.bottom && targetRect.bottom > panelRect.top) {
			panel.style.top = "auto"
			panel.style.bottom = "16px"
		}
	}

	async function setup(): Promise<PageController> {
		releaseChatDialogs()
		if (controller) return controller
		for (const root of options.exclude)
			root.addEventListener("toggle", releaseChatDialogs, { capture: true, signal: taskSignal })
		panel = document.createElement("div")
		panel.lang = options.language === "cs" ? "cs" : "en"
		const shadow = panel.attachShadow({ mode: "open" })
		const style = document.createElement("style")
		style.textContent = `:host{all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;width:min(340px,calc(100vw - 32px));font:15px/1.5 system-ui;color:#17202a}
section{background:#fff;border:1px solid #87929e;border-radius:12px;padding:16px;box-shadow:0 4px 24px #0003;max-height:calc(100dvh - 32px);box-sizing:border-box;display:flex;flex-direction:column}
p{margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;overflow-y:auto;min-height:0;max-height:40dvh}div{display:flex;gap:8px;flex-wrap:wrap;flex-shrink:0}
button{font:inherit;padding:8px 14px;min-height:44px;border:1px solid #56616d;border-radius:6px;background:#fff;color:#17202a;cursor:pointer}
button:focus-visible{outline:3px solid #2563eb;outline-offset:3px}`
		const section = document.createElement("section")
		section.setAttribute("aria-label", "Talqo")
		status = document.createElement("p")
		status.setAttribute("role", "status")
		status.tabIndex = 0
		buttons = document.createElement("div")
		const stop = document.createElement("button")
		stop.textContent = text.stop
		stop.addEventListener("click", () => {
			stopping.abort(new Error("Page task stopped"))
			void options.stop().catch(async () => {
				await setup()
				if (status) status.textContent = text.stopped
			})
		})
		section.append(status, buttons, stop)
		shadow.append(style, section)
		document.body.append(panel)
		highlight = document.createElement("div")
		highlight.style.cssText =
			"all:initial;position:fixed;pointer-events:none;z-index:2147483646;border:3px solid #2563eb;border-radius:4px;box-sizing:border-box"
		highlight.hidden = true
		document.body.append(highlight)
		const { PageController: Controller } = await import("@page-agent/page-controller")
		controller = new Controller({
			viewportExpansion: -1,
			highlightOpacity: 0,
			highlightLabelOpacity: 0,
			includeAttributes: ["value", "selected", "checked", "aria-label"],
			excludedRoots: [...options.exclude, panel, highlight],
			beforeAction: async (element) => {
				if (!validateAction) throw new Error("Page action is no longer active")
				await validateAction(element)
			},
		})
		return controller
	}

	async function observe() {
		const page = await setup()
		const state = await browserState(page)
		snapshot = { id: crypto.randomUUID(), content: state.content, url: state.url }
		return { snapshot: snapshot.id, ...state }
	}

	function validate(element: HTMLElement) {
		if (!element.isConnected || element.matches(":disabled, [aria-disabled=true]"))
			throw new Error("Target is unavailable. Observe the page again.")
		if (
			element.ownerDocument !== document ||
			options.exclude.some((root) => root.contains(element)) ||
			panel?.contains(element) ||
			highlight === element
		)
			throw new Error("Target is outside the permitted page.")
		const rect = element.getBoundingClientRect()
		if (!rect.width || !rect.height) throw new Error("Target is not visible.")
		const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / CENTER_DIVISOR))
		const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / CENTER_DIVISOR))
		const hit = document.elementFromPoint(x, y)
		if (hit !== element && !element.contains(hit))
			throw new Error(`Target is covered by ${hit?.tagName ?? "the viewport"}. Observe the page again.`)
		if (
			element instanceof HTMLAnchorElement &&
			((element.target && element.target !== "_self") || new URL(element.href).origin !== location.origin)
		)
			throw new Error("This link requires the visitor. Only this tab and origin can be controlled.")
		const form = element.closest("form")
		if (form && (new URL(form.action).origin !== location.origin || (form.target && form.target !== "_self")))
			throw new Error("This form requires the visitor. Only this tab and origin can be controlled.")
	}

	function approve(summary: string, element: HTMLElement, signal: AbortSignal): Promise<boolean> {
		return new Promise((resolve, reject) => {
			if (!buttons || !status) throw new Error("Page controls are unavailable")
			status.textContent = summary
			const finish = (approved: boolean) => {
				signal.removeEventListener("abort", abort)
				buttons?.replaceChildren()
				resolve(approved)
			}
			const abort = () => {
				buttons?.replaceChildren()
				reject(signal.reason)
			}
			signal.addEventListener("abort", abort, { once: true })
			for (const [label, approved] of [
				[text.approve, true],
				[text.cancel, false],
			] as const) {
				const button = document.createElement("button")
				button.textContent = label
				button.addEventListener("click", () => finish(approved), { once: true })
				buttons.append(button)
			}
			placePanel(element)
		})
	}

	return {
		dispose,
		definition: tool({
			description:
				"Observe and operate the current website. One action per call. For click, fill, and select supply snapshot, index, and description. Fill also requires text; select requires option; scroll requires down and description. To request approval, call the intended action with approval containing the exact proposal. The tool displays buttons and waits; do not ask for approval in chat. A successful click is dispatch only, not proof of purchase. Never replay an uncertain action.",
			inputSchema,
			async execute(operation, { abortSignal }): Promise<unknown> {
				const parsed = actionSchema.safeParse(operation)
				if (!parsed.success) return { status: "invalid", message: z.prettifyError(parsed.error) }
				const input = parsed.data
				if (busy) return { status: "busy", message: "Wait for the current page action." }
				busy = true
				if (activeSignal !== abortSignal) {
					activeSignal = abortSignal
					stopping = new AbortController()
					taskSignal = AbortSignal.any([stopping.signal, ...(abortSignal ? [abortSignal] : [])])
					taskSignal.addEventListener("abort", dispose, { once: true })
				}
				const signal = taskSignal
				try {
					signal.throwIfAborted()
					const page = await setup()
					signal.throwIfAborted()
					if (status) status.textContent = input.action === "observe" ? text.observing : input.description
					if (input.action === "observe") return await observe()
					if (input.action === "scroll") {
						const result = await page.scroll({ down: input.down, numPages: 1 })
						return { result, page: await observe() }
					}
					if (snapshot?.id !== input.snapshot) return { status: "stale", message: "Observe the page again." }
					const element = page.getElement(input.index)
					element.scrollIntoView({ block: "center", behavior: "instant" })
					placePanel(element)
					validate(element)
					const fingerprint = element.outerHTML
					const before = await browserState(page)
					if (
						page.getElement(input.index) !== element ||
						before.content !== snapshot.content ||
						before.url !== snapshot.url
					)
						return { status: "changed", page: await observe() }
					if (highlight) {
						const rect = element.getBoundingClientRect()
						Object.assign(highlight.style, {
							left: `${rect.left}px`,
							top: `${rect.top}px`,
							width: `${rect.width}px`,
							height: `${rect.height}px`,
						})
						highlight.hidden = false
					}
					if (input.approval && !(await approve(input.approval, element, signal)))
						return { status: "declined", message: "Do not retry this commitment without a new visitor request." }
					signal.throwIfAborted()
					validateAction = async (captured) => {
						signal.throwIfAborted()
						const latest = await browserState(page)
						signal.throwIfAborted()
						if (
							captured !== element ||
							latest.content !== before.content ||
							latest.url !== before.url ||
							page.getElement(input.index) !== element ||
							element.outerHTML !== fingerprint
						)
							throw new Error("The proposal changed. Observe the page and request fresh approval.")
						validate(element)
					}
					let result: { success: boolean; message: string }
					if (input.action === "click") result = await page.clickElement(input.index)
					else if (input.action === "fill") result = await page.inputText(input.index, input.text)
					else result = await page.selectOption(input.index, input.option)
					signal.throwIfAborted()
					return { status: result.success ? "dispatched" : "failed", result, page: await observe() }
				} catch (error) {
					if (signal.aborted) throw error
					return {
						status: "failed",
						message: error instanceof Error ? error.message : "Page action failed. Observe the page again.",
						...(controller ? { page: await observe() } : {}),
					}
				} finally {
					busy = false
					validateAction = undefined
					if (highlight) highlight.hidden = true
					if (signal.aborted) dispose()
				}
			},
		}),
	}
}
