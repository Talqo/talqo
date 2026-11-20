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
const PROPOSAL_CHANGED = "The proposal changed. Observe the page and request fresh approval."
const THEME_TOKENS = ["primary", "text-on-primary", "background", "surface", "text"]

const targetSchema = {
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
	z.object({ action: z.literal("click"), ...targetSchema }),
	z.object({ action: z.literal("fill"), ...targetSchema, text: z.string().max(INPUT_LIMIT) }),
	z.object({ action: z.literal("select"), ...targetSchema, option: z.string().max(OPTION_LIMIT) }),
	z.object({ action: z.literal("scroll"), down: z.boolean(), description: z.string().max(DESCRIPTION_LIMIT) }),
])
const inputSchema = z.object({
	action: z.enum(["observe", "click", "fill", "select", "scroll"]),
	...z.object(targetSchema).partial().shape,
	text: z.string().max(INPUT_LIMIT).optional(),
	option: z.string().max(OPTION_LIMIT).optional(),
	down: z.boolean().optional(),
})

type PageInput = z.infer<typeof actionSchema>
type InteractiveInput = Extract<PageInput, { action: "click" | "fill" | "select" }>
type FormControl = HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement

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

const PAYMENT_FIELD = /\bcc[-_]|\bpan\b|card.?number|credit.?card|debit.?card|cvv|cvc|security.?code/i
const PRIVATE_FIELD = /password|hidden|secret|token|one-time-code/i
const FIELD_ATTRIBUTES = ["type", "name", "id", "autocomplete", "aria-label", "placeholder"]

function fieldMetadata(element: Element): string {
	return [
		...FIELD_ATTRIBUTES.map((name) => element.getAttribute(name)),
		...element.getAttributeNames().filter((name) => name.startsWith("data-")),
	].join(" ")
}

function isPaymentContainer(element: Element | null | undefined): boolean {
	return (
		!!element &&
		(element.matches("[data-payment], #payment, [data-testid=payment]") ||
			(element.matches("form, fieldset") && /payment/i.test(fieldMetadata(element))))
	)
}

function isInsidePaymentContainer(element: Element): boolean {
	for (let node = element.parentNode; node; node = node instanceof ShadowRoot ? node.host : node.parentNode) {
		if (node instanceof Element && isPaymentContainer(node)) return true
	}
	return false
}

function isPrivateControl(element: Element): boolean {
	if (element.hasAttribute("data-payment")) return true
	const metadata = fieldMetadata(element)
	if (PRIVATE_FIELD.test(metadata) || PAYMENT_FIELD.test(metadata)) return true
	const form = element instanceof HTMLElement ? formControl(element)?.form : undefined
	return isPaymentContainer(form) || isInsidePaymentContainer(element)
}

function privateControls(root: Document | ShadowRoot): Element[] {
	const controls = [...root.querySelectorAll("input, textarea, select")].filter(isPrivateControl)
	for (const element of root.querySelectorAll("*"))
		if (element.shadowRoot) controls.push(...privateControls(element.shadowRoot))
	return controls
}

function focusedElement(): Element | null {
	let element = document.activeElement
	while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement
	return element
}

function assertTargetUsable(element: HTMLElement): void {
	if (!element.isConnected || element.matches(":disabled, [aria-disabled=true]"))
		throw new Error("Target is unavailable. Observe the page again.")
}

function isTargetOutsidePage(
	element: HTMLElement,
	panel: HTMLElement | undefined,
	highlight: HTMLElement | undefined,
	exclude: readonly Element[],
): boolean {
	return (
		element.ownerDocument !== document ||
		exclude.some((root) => root.contains(element)) ||
		!!panel?.contains(element) ||
		highlight === element
	)
}

function assertTargetVisible(element: HTMLElement): void {
	const rect = element.getBoundingClientRect()
	if (!rect.width || !rect.height) throw new Error("Target is not visible.")
	const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / CENTER_DIVISOR))
	const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / CENTER_DIVISOR))
	const hit = document.elementFromPoint(x, y)
	if (hit !== element && !element.contains(hit))
		throw new Error(`Target is covered by ${hit?.tagName ?? "the viewport"}. Observe the page again.`)
}

function pageBaseTarget(): string {
	return document.querySelector("base[target]")?.getAttribute("target") ?? "_self"
}

function assertSameTabLink(element: HTMLElement, baseTarget: string): void {
	const link = element.closest("a[href]")
	if (!(link instanceof HTMLAnchorElement)) return
	const target = (link.target || baseTarget).toLowerCase()
	if (target === "_self" && new URL(link.href).origin === location.origin) return
	throw new Error("This link requires the visitor. Only this tab and origin can be controlled.")
}

function formControl(element: HTMLElement): FormControl | undefined {
	const control = element.closest("button, input, select, textarea")
	if (
		control instanceof HTMLButtonElement ||
		control instanceof HTMLInputElement ||
		control instanceof HTMLSelectElement ||
		control instanceof HTMLTextAreaElement
	)
		return control
	return undefined
}

function formTargetBlocked(
	submitter: HTMLButtonElement | HTMLInputElement | undefined,
	form: HTMLFormElement,
	baseTarget: string,
): boolean {
	const action = submitter?.hasAttribute("formaction") ? submitter.formAction : form.action
	const target = (submitter?.getAttribute("formtarget") || form.target || baseTarget).toLowerCase()
	return new URL(action || location.href).origin !== location.origin || target !== "_self"
}

function assertSameTabForm(element: HTMLElement, baseTarget: string): void {
	const control = formControl(element)
	const form = control?.form ?? element.closest("form")
	if (!form) return
	const submitter = control instanceof HTMLButtonElement || control instanceof HTMLInputElement ? control : undefined
	if (formTargetBlocked(submitter, form, baseTarget))
		throw new Error("This form requires the visitor. Only this tab and origin can be controlled.")
}

function assertSameTarget(captured: HTMLElement, element: HTMLElement, page: PageController, index: number): void {
	if (captured !== element || page.getElement(index) !== element) throw new Error(PROPOSAL_CHANGED)
}

function assertSameContent(
	latest: BrowserState,
	baseline: { content: string; url: string; fingerprint: string },
	element: HTMLElement,
): void {
	if (
		latest.content !== baseline.content ||
		location.href !== baseline.url ||
		element.outerHTML !== baseline.fingerprint
	)
		throw new Error(PROPOSAL_CHANGED)
}

function assertSamePage(
	latest: BrowserState | undefined,
	baseline: { content: string; url: string; fingerprint: string },
	element: HTMLElement,
): void {
	if (!latest) return
	assertSameContent(latest, baseline, element)
}

function restoreIgnoredRoots(previous: Map<Element, string | null>): void {
	for (const [root, value] of previous) {
		if (value === null) root.removeAttribute("data-page-agent-ignore")
		else root.setAttribute("data-page-agent-ignore", value)
	}
}
function reopenDialog(dialog: HTMLDialogElement, focus: Element | null): void {
	if (!shouldReopen(dialog, focus)) return
	dialog.close()
	dialog.showModal()
	if (focus instanceof HTMLElement) focus.focus({ preventScroll: true })
}

function shouldReopen(dialog: HTMLDialogElement, focus: Element | null): boolean {
	return isReopenable(dialog) && holdsFocus(dialog, focus)
}

function isReopenable(dialog: HTMLDialogElement): boolean {
	return dialog.isConnected && dialog.open && !dialog.matches(":modal")
}

function holdsFocus(dialog: HTMLDialogElement, focus: Element | null): boolean {
	return focus !== null && dialog.contains(focus)
}
function dialogsIn(root: Element): HTMLDialogElement[] {
	const dialogs = [...root.querySelectorAll<HTMLDialogElement>("dialog:modal")]
	if (root instanceof HTMLDialogElement && root.matches(":modal")) dialogs.push(root)
	return dialogs
}
function createHighlight(shadow: ShadowRoot): HTMLElement {
	const element = document.createElement("div")
	element.className = "highlight"
	element.style.borderColor = getComputedStyle(shadow.host).getPropertyValue("--talqo-primary-input")
	element.hidden = true
	shadow.append(element)
	return element
}
function pageChanged(
	page: PageController,
	index: number,
	element: HTMLElement,
	observed: { content: string; url: string },
	state: BrowserState,
): boolean {
	return page.getElement(index) !== element || state.content !== observed.content || location.href !== observed.url
}
async function dispatchAction(page: PageController, input: InteractiveInput) {
	if (input.action === "click") return page.clickElement(input.index)
	if (input.action === "fill") return page.inputText(input.index, input.text)
	return page.selectOption(input.index, input.option)
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

	function validate(element: HTMLElement): void {
		assertTargetUsable(element)
		if (
			isTargetOutsidePage(element, panel, highlight, options.exclude) ||
			(element.matches("input, textarea, select") && isPrivateControl(element))
		)
			throw new Error("Target is outside the permitted page.")
		assertTargetVisible(element)
		const baseTarget = pageBaseTarget()
		assertSameTabLink(element, baseTarget)
		assertSameTabForm(element, baseTarget)
	}

	function ignoredRoots(): Element[] {
		const roots = [...options.exclude, ...privateControls(document)]
		if (panel) roots.push(panel)
		if (highlight) roots.push(highlight)
		return roots
	}

	async function browserState(page: PageController): Promise<BrowserState> {
		const roots = ignoredRoots()
		const previous = new Map(roots.map((root) => [root, root.getAttribute("data-page-agent-ignore")]))
		for (const root of roots) root.setAttribute("data-page-agent-ignore", "true")
		let state: BrowserState
		try {
			state = await page.getBrowserState()
		} finally {
			restoreIgnoredRoots(previous)
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

	function restoreModalDialogs(): void {
		const focus = focusedElement()
		for (const dialog of modalDialogs) reopenDialog(dialog, focus)
		modalDialogs = []
	}

	function dispose() {
		const hadApprovalFocus = !!panel?.shadowRoot?.activeElement
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
		if (hadApprovalFocus && approvalFocus?.isConnected) approvalFocus.focus({ preventScroll: true })
		approvalFocus = undefined
		restoreModalDialogs()
	}

	function releaseChatDialog(dialog: HTMLDialogElement): void {
		const focus = focusedElement()
		if (!modalDialogs.includes(dialog)) modalDialogs.push(dialog)
		dialog.close()
		dialog.show()
		if (focus instanceof HTMLElement && dialog.contains(focus)) focus.focus({ preventScroll: true })
	}

	function releaseChatDialogs(): void {
		// A modal chat makes the host page and approval controls inert.
		for (const root of options.exclude) for (const dialog of dialogsIn(root)) releaseChatDialog(dialog)
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

	function applyThemeToken(theme: CSSStyleDeclaration, token: string): void {
		const property = `--talqo-${token}-input`
		const value = theme.getPropertyValue(property).trim()
		if (value) panel?.style.setProperty(property, value)
		else panel?.style.removeProperty(property)
	}

	function syncTheme(themeRoot: Element): void {
		const theme = getComputedStyle(themeRoot)
		for (const token of THEME_TOKENS) applyThemeToken(theme, token)
		if (highlight && panel)
			highlight.style.borderColor = getComputedStyle(panel).getPropertyValue("--talqo-primary-input")
	}

	function watchTheme(themeRoot: Element): void {
		const sync = () => syncTheme(themeRoot)
		sync()
		themeObserver = new MutationObserver(sync)
		themeObserver.observe(themeRoot, { attributes: true, attributeFilter: ["style", "class", "data-scheme"] })
	}

	function stopTask(): void {
		stopping.abort(new Error("Page task stopped"))
		void options.stop().catch(async () => {
			await setup()
			if (status) status.textContent = text.stopped
		})
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
		stop.addEventListener("click", stopTask)
		header.append(heading, stop)
		section.append(header, status, buttons)
		shadow.append(style, section)
		document.body.append(panel)
		const themeRoot = options.themeRoot?.()
		if (themeRoot) watchTheme(themeRoot)
		highlight = createHighlight(shadow)
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

	function renderDecisionButton(label: string, approved: boolean, finish: (approved: boolean) => void): void {
		const button = document.createElement("button")
		if (approved) button.dataset.primary = ""
		button.textContent = label
		if (!approved) button.title = options.language === "cs" ? "Odmítnout tuto akci" : "Decline this action"
		button.addEventListener("click", () => finish(approved), { once: true })
		buttons?.append(button)
	}

	function renderDecisionButtons(finish: (approved: boolean) => void): void {
		renderDecisionButton(text.approve, true, finish)
		renderDecisionButton(text.cancel, false, finish)
	}

	function approve(summary: string, element: HTMLElement, signal: AbortSignal): Promise<boolean> {
		return new Promise((resolve, reject) => {
			signal.throwIfAborted()
			if (!buttons || !status || !panel || !highlight) throw new Error("Page controls are unavailable")
			status.textContent = summary
			const focus = focusedElement()
			approvalFocus = focus instanceof HTMLElement ? focus : undefined
			if (heading) heading.textContent = text.approval
			function finish(approved: boolean): void {
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
			function abort(): void {
				stopPositioning()
				buttons?.replaceChildren()
				reject(signal.reason)
			}
			signal.addEventListener("abort", abort, { once: true })
			renderDecisionButtons(finish)
			const stopPositioning = anchorPageApproval(panel, highlight, element, options.exclude)
			buttons.querySelector("button")?.focus({ preventScroll: true })
		})
	}

	function createActionValidator(
		page: PageController,
		input: InteractiveInput,
		element: HTMLElement,
		baseline: { content: string; url: string; fingerprint: string },
		signal: AbortSignal,
	): (element: HTMLElement) => Promise<void> {
		let actionValidated = false
		return async (captured) => {
			signal.throwIfAborted()
			const latest = !actionValidated || input.approval ? await browserState(page) : undefined
			signal.throwIfAborted()
			assertSameTarget(captured, element, page, input.index)
			assertSamePage(latest, baseline, element)
			validate(element)
			actionValidated = true
		}
	}

	function showProgress(input: PageInput): void {
		if (heading) heading.textContent = text.working
		if (status) status.textContent = input.action === "observe" ? text.observing : input.description
	}

	async function scrollPage(page: PageController, input: Extract<PageInput, { action: "scroll" }>) {
		const result = await page.scroll({ down: input.down, numPages: 1 })
		return { result, page: await observe() }
	}

	function revealHighlight(element: HTMLElement): void {
		if (!highlight) return
		const rect = element.getBoundingClientRect()
		Object.assign(highlight.style, {
			left: `${rect.left}px`,
			top: `${rect.top}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		})
		highlight.hidden = false
	}

	async function interact(page: PageController, input: InteractiveInput, signal: AbortSignal): Promise<unknown> {
		const observed = snapshot
		if (!observed || observed.id !== input.snapshot) return { status: "stale", message: "Observe the page again." }
		const element = page.getElement(input.index)
		element.scrollIntoView({ block: "center", behavior: "instant" })
		placePanel(element)
		validate(element)
		const baseline = {
			fingerprint: element.outerHTML,
			url: location.href,
			content: "",
		}
		const before = await browserState(page)
		baseline.content = before.content
		if (pageChanged(page, input.index, element, observed, before)) return { status: "changed", page: await observe() }
		revealHighlight(element)
		if (input.approval && !(await approve(input.approval, element, signal)))
			return { status: "declined", message: "Do not retry this commitment without a new visitor request." }
		signal.throwIfAborted()
		validateAction = createActionValidator(page, input, element, baseline, signal)
		const result = await dispatchAction(page, input)
		signal.throwIfAborted()
		return { status: result.success ? "dispatched" : "failed", result, page: await observe() }
	}

	async function runOperation(input: PageInput, signal: AbortSignal): Promise<unknown> {
		signal.throwIfAborted()
		const page = await setup()
		signal.throwIfAborted()
		showProgress(input)
		if (input.action === "observe") return await observe()
		if (input.action === "scroll") return await scrollPage(page, input)
		return await interact(page, input, signal)
	}

	function startTask(abortSignal: AbortSignal | undefined): AbortSignal {
		if (activeSignal !== abortSignal) {
			activeSignal = abortSignal
			stopping = new AbortController()
			taskSignal = AbortSignal.any([stopping.signal, ...(abortSignal ? [abortSignal] : [])])
			taskSignal.addEventListener("abort", dispose, { once: true })
		}
		return taskSignal
	}

	function restoreApprovalFocus(): void {
		if (!approvalFocus) return
		if (approvalFocus.isConnected && panel?.shadowRoot?.activeElement) approvalFocus.focus({ preventScroll: true })
		approvalFocus = undefined
	}

	function finishOperation(signal: AbortSignal): void {
		busy = false
		validateAction = undefined
		if (highlight) highlight.hidden = true
		restoreApprovalFocus()
		if (signal.aborted) dispose()
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
				if (busy) return { status: "busy", message: "Wait for the current page action." }
				busy = true
				const signal = startTask(abortSignal)
				try {
					return await runOperation(parsed.data, signal)
				} catch (error) {
					if (signal.aborted) throw error
					return {
						status: "failed",
						message: error instanceof Error ? error.message : "Page action failed. Observe the page again.",
						...(controller ? { page: await observe() } : {}),
					}
				} finally {
					finishOperation(signal)
				}
			},
		}),
	}
}
