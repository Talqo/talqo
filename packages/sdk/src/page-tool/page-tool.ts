import type { BrowserState, PageController } from "@talqo/page-controller"
import type { Tool } from "ai"

import { DEFAULT_APPROVAL_INSTRUCTIONS, PAGE_TOOL_NAME } from "@talqo/shared/page-control"
import { tool } from "ai"
import { z } from "zod"

import { anchorPageApproval } from "./page-tool-position.ts"

import pageToolStyles from "./page-tool.css" with { type: "text" }

export { PAGE_TOOL_NAME }
const DESCRIPTION_LIMIT = 300
const APPROVAL_LIMIT = 2000
const INPUT_LIMIT = 10_000
const OPTION_LIMIT = 1000
const CENTER_DIVISOR = 2

const target = {
	snapshot: z.string().describe("Required for click, fill, and select. Copy the latest observation's snapshot."),
	index: z.number().int().nonnegative(),
	description: z
		.string()
		.min(1)
		.max(DESCRIPTION_LIMIT)
		.describe(
			"A short visitor-facing action, such as 'Entering your delivery address'. Never show selectors or HTML attributes.",
		),
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
		working: "Working on this page",
		approval: "Your approval is needed",
		stopped: "Could not stop the agent. Try Stop in chat.",
		declined: "Action declined.",
	},
	cs: {
		approve: "Schválit",
		cancel: "Zrušit",
		stop: "Zastavit",
		observing: "Čtu tuto stránku",
		working: "Pracuji na této stránce",
		approval: "Je potřeba vaše schválení",
		stopped: "Agenta se nepodařilo zastavit. Zkuste Zastavit v chatu.",
		declined: "Akce nebyla schválena.",
	},
}

function privateControls(root: Document | ShadowRoot): Element[] {
	const controls = [...root.querySelectorAll("input, textarea")].filter((element) => {
		const fields = ["type", "name", "id", "autocomplete"].map((name) => element.getAttribute(name) ?? "").join(" ")
		return /password|hidden|secret|token|cc-|card.?number|cvv|cvc|one-time-code/i.test(fields)
	})
	for (const element of root.querySelectorAll("*"))
		if (element.shadowRoot) controls.push(...privateControls(element.shadowRoot))
	return controls
}

function focusedElement(): Element | null {
	let element = document.activeElement
	while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement
	return element
}

export function createPageTool(options: {
	exclude: readonly Element[]
	language: string
	approvalInstructions?: string
	themeRoot?: () => Element | null
	stop(): Promise<void>
}): {
	dispose(): void
	definition: Tool<z.infer<typeof inputSchema>, unknown>
} {
	let controller: PageController | undefined
	let panel: HTMLElement | undefined
	let status: HTMLElement | undefined
	let buttons: HTMLElement | undefined
	let heading: HTMLElement | undefined
	let themeObserver: MutationObserver | undefined
	let highlight: HTMLElement | undefined
	let snapshot: { id: string; content: string; url: string } | undefined
	let busy = false
	let modalDialogs: HTMLDialogElement[] = []
	let approvalFocus: HTMLElement | undefined
	let validateAction: ((element: HTMLElement) => Promise<void>) | undefined
	let activeSignal: AbortSignal | undefined
	let stopping = new AbortController()
	let taskSignal = stopping.signal
	const text = options.language === "cs" ? labels.cs : labels.en
	async function browserState(page: PageController): Promise<BrowserState> {
		const excludedRoots = [...options.exclude, ...privateControls(document)]
		if (panel) excludedRoots.push(panel)
		if (highlight) excludedRoots.push(highlight)
		const previous = new Map(excludedRoots.map((root) => [root, root.getAttribute("data-page-agent-ignore")]))
		for (const root of previous.keys()) root.setAttribute("data-page-agent-ignore", "true")
		let state: BrowserState
		try {
			state = await page.getBrowserState()
		} finally {
			for (const [root, value] of previous) {
				if (value === null) root.removeAttribute("data-page-agent-ignore")
				else root.setAttribute("data-page-agent-ignore", value)
			}
		}
		const url = new URL(state.url)
		url.search = ""
		url.hash = ""
		url.username = ""
		url.password = ""
		return {
			...state,
			url: url.href,
			header: state.header.replaceAll(state.url, url.href),
			content: state.content.replace(/\*\[(\d+)\]/g, "[$1]"),
		}
	}

	function dispose() {
		const restoreApprovalFocus = !!panel?.shadowRoot?.activeElement
		stopping.abort(new Error("Page task ended"))
		controller?.dispose()
		controller = undefined
		panel?.remove()
		panel = undefined
		highlight?.remove()
		highlight = undefined
		status = undefined
		buttons = undefined
		heading = undefined
		themeObserver?.disconnect()
		themeObserver = undefined
		snapshot = undefined
		validateAction = undefined
		if (restoreApprovalFocus && approvalFocus?.isConnected) approvalFocus.focus({ preventScroll: true })
		approvalFocus = undefined
		const focus = focusedElement()
		for (const dialog of modalDialogs) {
			if (dialog.isConnected && dialog.open && !dialog.matches(":modal") && focus && dialog.contains(focus)) {
				dialog.close()
				dialog.showModal()
				if (focus instanceof HTMLElement) focus.focus({ preventScroll: true })
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
				const focus = focusedElement()
				if (!modalDialogs.includes(dialog)) modalDialogs.push(dialog)
				dialog.close()
				dialog.show()
				if (focus instanceof HTMLElement && dialog.contains(focus)) focus.focus({ preventScroll: true })
			}
		}
	}

	function placePanel(element: HTMLElement): void {
		if (!panel) return
		panel.style.top = "16px"
		panel.style.bottom = "auto"
		panel.style.left = "auto"
		panel.style.right = "16px"
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
		style.textContent = pageToolStyles
		const section = document.createElement("section")
		section.setAttribute("aria-label", "Talqo")
		const header = document.createElement("header")
		heading = document.createElement("h2")
		heading.textContent = text.working
		status = document.createElement("p")
		status.setAttribute("role", "status")
		status.tabIndex = 0
		buttons = document.createElement("div")
		buttons.className = "actions"
		const stop = document.createElement("button")
		stop.textContent = text.stop
		stop.title = options.language === "cs" ? "Zastavit celý úkol" : "Stop the entire task"
		stop.addEventListener("click", () => {
			stopping.abort(new Error("Page task stopped"))
			void options.stop().catch(async () => {
				await setup()
				if (status) status.textContent = text.stopped
			})
		})
		header.append(heading, stop)
		section.append(header, status, buttons)
		shadow.append(style, section)
		document.body.append(panel)
		const themeRoot = options.themeRoot?.()
		if (themeRoot) {
			const syncTheme = () => {
				const theme = getComputedStyle(themeRoot)
				for (const token of ["primary", "text-on-primary", "background", "surface", "text"]) {
					const property = `--talqo-${token}-input`
					const value = theme.getPropertyValue(property).trim()
					if (value) panel?.style.setProperty(property, value)
					else panel?.style.removeProperty(property)
				}
				if (highlight && panel)
					highlight.style.borderColor = getComputedStyle(panel).getPropertyValue("--talqo-primary-input")
			}
			syncTheme()
			themeObserver = new MutationObserver(syncTheme)
			themeObserver.observe(themeRoot, { attributes: true, attributeFilter: ["style", "class", "data-scheme"] })
		}
		highlight = document.createElement("div")
		highlight.className = "highlight"
		highlight.style.borderColor = getComputedStyle(panel).getPropertyValue("--talqo-primary-input")
		highlight.hidden = true
		shadow.append(highlight)
		const { PageController: Controller } = await import("@talqo/page-controller")
		controller = new Controller({
			viewportExpansion: -1,
			highlightOpacity: 0,
			highlightLabelOpacity: 0,
			includeAttributes: ["value", "selected", "checked", "aria-label"],
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
		snapshot = { id: crypto.randomUUID(), content: state.content, url: location.href }
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
		const baseTarget = document.querySelector("base[target]")?.getAttribute("target") ?? "_self"
		const link = element.closest("a[href]")
		if (
			link instanceof HTMLAnchorElement &&
			((link.target || baseTarget).toLowerCase() !== "_self" || new URL(link.href).origin !== location.origin)
		)
			throw new Error("This link requires the visitor. Only this tab and origin can be controlled.")
		const control = element.closest("button, input, select, textarea")
		const form =
			control instanceof HTMLButtonElement ||
			control instanceof HTMLInputElement ||
			control instanceof HTMLSelectElement ||
			control instanceof HTMLTextAreaElement
				? control.form
				: element.closest("form")
		const submitter = control instanceof HTMLButtonElement || control instanceof HTMLInputElement ? control : undefined
		const action = submitter?.hasAttribute("formaction") ? submitter.formAction : form?.action
		const formTarget = (submitter?.getAttribute("formtarget") || form?.target || baseTarget).toLowerCase()
		if (form && (new URL(action || location.href).origin !== location.origin || formTarget !== "_self"))
			throw new Error("This form requires the visitor. Only this tab and origin can be controlled.")
	}

	function approve(summary: string, element: HTMLElement, signal: AbortSignal): Promise<boolean> {
		return new Promise((resolve, reject) => {
			if (!buttons || !status || !panel || !highlight) throw new Error("Page controls are unavailable")
			status.textContent = summary
			const focus = focusedElement()
			approvalFocus = focus instanceof HTMLElement ? focus : undefined
			if (heading) heading.textContent = text.approval
			const finish = (approved: boolean) => {
				stopPositioning()
				signal.removeEventListener("abort", abort)
				buttons?.replaceChildren()
				if (heading) heading.textContent = text.working
				if (status) {
					status.textContent = approved ? text.working : text.declined
					status.focus({ preventScroll: true })
				}
				resolve(approved)
			}
			const abort = () => {
				stopPositioning()
				buttons?.replaceChildren()
				reject(signal.reason)
			}
			signal.addEventListener("abort", abort, { once: true })
			for (const [label, approved] of [
				[text.approve, true],
				[text.cancel, false],
			] as const) {
				const button = document.createElement("button")
				if (approved) button.dataset.primary = ""
				button.textContent = label
				if (!approved) button.title = options.language === "cs" ? "Odmítnout tuto akci" : "Decline this action"
				button.addEventListener("click", () => finish(approved), { once: true })
				buttons.append(button)
			}
			const stopPositioning = anchorPageApproval(panel, highlight, element, options.exclude)
			buttons.querySelector("button")?.focus({ preventScroll: true })
		})
	}

	return {
		dispose,
		definition: tool({
			description: `Observe and operate the current website to complete the visitor's objective. For click, fill, and select supply snapshot, index, and description. Fill requires text; select requires option; scroll requires down and description.
Ask for missing details; never invent them. When approval is needed, call the intended action with approval describing the commitment, products, quantities, total including fees, and delivery details. The tool waits for buttons; do not ask for approval in chat.
Do not retry a declined commitment without a new visitor request, or repeat a purchase or payment whose outcome is uncertain. After interruption, observe to establish the outcome. Confirm success from the website; otherwise report uncertainty.
Approval rules:
${options.approvalInstructions ?? DEFAULT_APPROVAL_INSTRUCTIONS}`,
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
					if (heading) heading.textContent = text.working
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
					const beforeUrl = location.href
					const before = await browserState(page)
					if (
						page.getElement(input.index) !== element ||
						before.content !== snapshot.content ||
						beforeUrl !== snapshot.url
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
					let actionValidated = false
					validateAction = async (captured) => {
						signal.throwIfAborted()
						const latest = !actionValidated || input.approval ? await browserState(page) : undefined
						signal.throwIfAborted()
						if (
							captured !== element ||
							(latest && latest.content !== before.content) ||
							location.href !== beforeUrl ||
							page.getElement(input.index) !== element ||
							(latest && element.outerHTML !== fingerprint)
						)
							throw new Error("The proposal changed. Observe the page and request fresh approval.")
						validate(element)
						actionValidated = true
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
					if (approvalFocus) {
						if (approvalFocus.isConnected && panel?.shadowRoot?.activeElement)
							approvalFocus.focus({ preventScroll: true })
						approvalFocus = undefined
					}
					if (signal.aborted) dispose()
				}
			},
		}),
	}
}
