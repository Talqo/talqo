import { captureClientTools } from "@/client-tools.ts"
import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test"

const controllerState: {
	content: string
	url: string
	element: HTMLElement | undefined
	disposed: boolean
	lastOptions: Record<string, unknown> | undefined
	onState?: () => void
	onAction?: () => void
} = {
	content: "*[1] Buy",
	url: "http://localhost/shop?page=1#top",
	element: undefined,
	disposed: false,
	lastOptions: undefined,
}

class FakeController {
	constructor(options: Record<string, unknown>) {
		controllerState.lastOptions = options
	}
	async getBrowserState() {
		controllerState.onState?.()
		return {
			url: controllerState.url,
			header: `Header ${controllerState.url}`,
			content: controllerState.content,
		}
	}
	getElement() {
		return controllerState.element!
	}
	async clickElement() {
		await (controllerState.lastOptions?.beforeAction as ((element: HTMLElement) => Promise<void>) | undefined)?.(
			controllerState.element!,
		)
		controllerState.onAction?.()
		return { success: true, message: "clicked" }
	}
	async inputText() {
		await (controllerState.lastOptions?.beforeAction as ((element: HTMLElement) => Promise<void>) | undefined)?.(
			controllerState.element!,
		)
		return { success: true, message: "typed" }
	}
	async selectOption() {
		await (controllerState.lastOptions?.beforeAction as ((element: HTMLElement) => Promise<void>) | undefined)?.(
			controllerState.element!,
		)
		return { success: true, message: "selected" }
	}
	async scroll() {
		return "scrolled"
	}
	dispose() {
		controllerState.disposed = true
	}
}

void mock.module("@talqo/page-controller", () => ({ PageController: FakeController }))

import { setRect } from "./test-dom.ts"

const { createPageTool } = await import("./page-tool.ts")

type PageTool = ReturnType<typeof createPageTool>
type ToolInput = Record<string, unknown>

beforeAll(() => {
	GlobalRegistrator.register({ url: "http://localhost/shop?page=1" })
})

afterAll(() => {
	void GlobalRegistrator.unregister()
})

beforeEach(() => {
	controllerState.content = "*[1] Buy"
	controllerState.url = "http://localhost/shop?page=1#top"
	controllerState.disposed = false
	controllerState.lastOptions = undefined
	controllerState.onState = undefined
	controllerState.onAction = undefined
	document.body.innerHTML = ""
})

function buttonFixture(): HTMLElement {
	document.body.innerHTML = '<main><button id="buy">Buy</button></main>'
	const element = document.querySelector<HTMLElement>("#buy")!
	setRect(element, 20, 40)
	controllerState.element = element
	return element
}

function newPage(overrides: Partial<Parameters<typeof createPageTool>[0]> = {}): PageTool {
	return createPageTool({ exclude: [], language: "en", ...overrides })
}

function clickButton(label: string): void {
	;[...shadowButtons()].find((candidate) => candidate.textContent === label)?.click()
}

async function pendingApproval(tools: ReturnType<typeof toolsFor>, signal?: AbortSignal) {
	return execute(
		tools,
		{
			action: "click",
			snapshot: await observeSnapshot(tools),
			index: 0,
			approval: "Buy the shirt for $25.",
		},
		signal,
	)
}

function toolsFor(page: PageTool) {
	return captureClientTools({ talqo_page: page.definition })
}

async function observeSnapshot(tools: ReturnType<typeof toolsFor>): Promise<string> {
	return ((await execute(tools, { action: "observe" })) as { snapshot: string }).snapshot
}

function execute(tools: ReturnType<typeof toolsFor>, input: ToolInput, signal = new AbortController().signal) {
	return tools.execute(
		{ version: 1, type: "tool-call", toolCallId: "call", toolName: "talqo_page", input, messages: [] },
		signal,
	)
}

function shadowButtons(): NodeListOf<HTMLButtonElement> {
	const panel = document.body.querySelector<HTMLElement>("div:last-child")!
	return panel.shadowRoot!.querySelectorAll("button")
}

test("observes and acts with only a target highlight, without on-page status controls", async () => {
	buttonFixture()
	const page = newPage()
	const tools = toolsFor(page)
	const signal = new AbortController().signal
	const snapshot = await observeSnapshot(tools)
	const root = document.body.querySelector<HTMLElement>("div:last-child")!.shadowRoot!
	expect(root.querySelector("section")).toBeNull()
	expect(shadowButtons()).toHaveLength(0)
	controllerState.onAction = () => {
		expect(root.querySelector<HTMLElement>(".highlight")?.hidden).toBe(false)
		expect(root.querySelector("section")).toBeNull()
	}
	expect(await execute(tools, { action: "click", snapshot, index: 0 }, signal)).toMatchObject({
		status: "dispatched",
	})
	expect(root.querySelector<HTMLElement>(".highlight")?.hidden).toBe(true)
	expect(root.querySelector("section")).toBeNull()
	page.dispose()
	expect(root.host.isConnected).toBe(false)
})

test("excludes private elements and sensitive ARIA labels while keeping ordinary fields available", async () => {
	document.body.innerHTML = `<main aria-label="Payments">
		<input id="password" type="password">
		<input id="number" type="tel" name="credit-card" aria-label="Card number">
		<select id="saved" aria-label="Saved credit card"><option>Saved card</option></select>
		<form data-payment><input id="code" name="code"></form>
		<section data-payment><div><input id="wrapped" name="number"></div></section>
		<input id="hidden" type="hidden">
		<iframe id="frame" srcdoc="<p>Private frame content</p>"></iframe>
		<section id="secrets" aria-label="API secrets"><p>Private credentials</p></section>
		<input name="quantity" aria-label="Quantity">
		<input name="secret" placeholder="Token">
		<section aria-label="Order details"><p>Public order details</p></section>
		<button id="buy">Buy</button>
	</main>`
	controllerState.onState = () => {
		expect(
			new Set([...document.querySelectorAll("main [data-page-agent-ignore]")].map((element) => element.id)),
		).toEqual(new Set(["password", "number", "saved", "hidden", "frame", "secrets"]))
	}
	controllerState.element = document.querySelector("#buy") as HTMLElement
	const page = newPage()
	const result = (await execute(toolsFor(page), { action: "observe" })) as Record<string, unknown>
	expect(result).toMatchObject({ url: "http://localhost/shop", content: "[1] Buy" })
	expect(String(result.snapshot)).toHaveLength(36)
	expect(controllerState.disposed).toBe(false)
	page.dispose()
})

test.each(["page", "shadow", "host"])(
	"excludes marked subtrees in the %s and rejects newly hidden targets",
	async (location) => {
		const host = document.createElement("div")
		document.body.append(host)
		const root = location === "page" ? host : host.attachShadow({ mode: "open" })
		const section = document.createElement("section")
		section.innerHTML = "<p>Private account details</p><button>Reveal</button>"
		root.append(section)
		const boundary = location === "host" ? host : section
		const button = section.querySelector("button")!
		setRect(button, 20, 40)
		controllerState.element = button
		const page = newPage()
		const tools = toolsFor(page)
		try {
			const snapshot = await observeSnapshot(tools)
			boundary.setAttribute("data-talqo-hidden", "")
			expect(await execute(tools, { action: "click", snapshot, index: 0 })).toMatchObject({
				status: "failed",
				message: "Target is outside the permitted page.",
			})
			controllerState.onState = () => {
				expect(boundary.getAttribute("data-page-agent-ignore")).toBe("true")
			}
			await observeSnapshot(tools)
			expect(boundary.hasAttribute("data-page-agent-ignore")).toBe(false)
			boundary.removeAttribute("data-talqo-hidden")
			controllerState.onState = undefined
			expect(await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0 })).toMatchObject(
				{
					status: "dispatched",
				},
			)
		} finally {
			page.dispose()
		}
	},
)

test("scrolls the page and re-observes", async () => {
	controllerState.element = undefined
	const page = newPage({ language: "cs", themeRoot: () => document.body })
	const result = (await execute(toolsFor(page), { action: "scroll", down: true })) as {
		result: string
		page: { snapshot: string }
	}
	expect(result.result).toBe("scrolled")
	expect(result.page.snapshot).toHaveLength(36)
	page.dispose()
})

test("approves a click, validates the proposal, and reports dispatch", async () => {
	buttonFixture()
	const composer = document.createElement("input")
	document.body.append(composer)
	composer.focus()
	const page = newPage()
	const tools = toolsFor(page)
	const pending = pendingApproval(tools)
	await Bun.sleep(10)
	const approve = [...shadowButtons()].find((button) => button.textContent === "Approve")
	const root = approve?.getRootNode()
	if (!approve || !(root instanceof ShadowRoot)) throw new Error("Missing approval button")
	expect(document.activeElement === composer).toBe(true)
	expect(root.getElementById(approve.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
		"Buy the shirt for $25.",
	)
	expect(shadowButtons()).toHaveLength(2)
	approve.focus()
	approve.click()
	const result = (await pending) as Record<string, unknown>
	expect(result).toMatchObject({ status: "dispatched", result: { success: true } })
	expect(root.querySelector("section")).toBeNull()
	expect(document.activeElement === composer).toBe(true)
	page.dispose()
})

test("declines an approved action without dispatching it", async () => {
	buttonFixture()
	const page = newPage()
	const tools = toolsFor(page)
	const pending = pendingApproval(tools)
	await Bun.sleep(10)
	const root = document.body.querySelector<HTMLElement>("div:last-child")!.shadowRoot!
	clickButton("Cancel")
	expect(await pending).toMatchObject({ status: "declined" })
	expect(root.querySelector("section")).toBeNull()
	page.dispose()
})

test.each(["cancel", "dispose"])("%s interrupts a pending approval and removes page controls", async (reason) => {
	buttonFixture()
	const page = newPage()
	const tools = toolsFor(page)
	const controller = new AbortController()
	const pending = pendingApproval(tools, controller.signal)
	await Bun.sleep(10)
	const host = document.body.querySelector<HTMLElement>("div:last-child")!
	if (reason === "cancel") controller.abort(new Error("Visitor cancelled"))
	else page.dispose()
	await expect(pending).rejects.toThrow(reason === "cancel" ? "Visitor cancelled" : "Page task ended")
	expect(host.isConnected).toBe(false)
	expect(controllerState.disposed).toBe(true)
})

test("does not open approval when Stop lands during page revalidation", async () => {
	buttonFixture()
	const page = newPage()
	const tools = toolsFor(page)
	const controller = new AbortController()
	const snapshot = await observeSnapshot(tools)
	controllerState.onState = () => controller.abort(new Error("Visitor stopped"))
	await expect(
		execute(tools, { action: "click", snapshot, index: 0, approval: "Buy for $25" }, controller.signal),
	).rejects.toThrow("Visitor stopped")
})

test("reports a stale snapshot and a changed page", async () => {
	document.body.innerHTML = '<main><button id="buy">Buy</button></main>'
	const element = document.querySelector("#buy") as HTMLElement
	setRect(element, 20, 40)
	controllerState.element = element
	const page = newPage()
	const tools = toolsFor(page)
	expect(await execute(tools, { action: "click", snapshot: "other", index: 0 })).toMatchObject({
		status: "stale",
	})
	const snapshot = await observeSnapshot(tools)
	controllerState.onState = () => {
		controllerState.element = document.createElement("button")
	}
	expect(await execute(tools, { action: "click", snapshot, index: 0 })).toMatchObject({
		status: "changed",
	})
	page.dispose()
})

test("validates links and forms before dispatch", async () => {
	document.body.innerHTML =
		'<main><a id="away" href="https://example.com" target="_blank">Away</a><form action="https://example.com"><button id="submit">Send</button></form></main>'
	const page = newPage()
	const tools = toolsFor(page)
	const link = document.querySelector("#away") as HTMLElement
	setRect(link, 20, 40)
	controllerState.element = link
	expect(await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0 })).toMatchObject({
		status: "failed",
		message: "This link requires the visitor. Only this tab and origin can be controlled.",
	})
	const submit = document.querySelector("#submit") as HTMLElement
	setRect(submit, 20, 40)
	controllerState.element = submit
	expect(await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0 })).toMatchObject({
		status: "failed",
		message: "This form requires the visitor. Only this tab and origin can be controlled.",
	})
	page.dispose()
})

test("rejects unavailable targets", async () => {
	document.body.innerHTML = '<main><button id="buy" disabled>Buy</button></main>'
	const page = newPage()
	const tools = toolsFor(page)
	const disabled = document.querySelector("#buy") as HTMLElement
	controllerState.element = disabled
	expect(await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0 })).toMatchObject({
		status: "failed",
		message: "Target is unavailable. Observe the page again.",
	})
	page.dispose()
})

test("makes chat inert during dispatch and restores its interaction state", async () => {
	buttonFixture()
	const chat = document.createElement("aside")
	chat.innerHTML = "<button>Send</button>"
	document.body.append(chat)
	const page = newPage({ exclude: [chat] })
	const tools = toolsFor(page)
	controllerState.onAction = () => {
		expect(chat.inert).toBe(true)
	}
	expect(await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0 })).toMatchObject({
		status: "dispatched",
	})
	expect(chat.inert).toBe(false)

	controllerState.onAction = () => {
		throw new Error("Click failed")
	}
	expect(await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0 })).toMatchObject({
		status: "failed",
		message: "Click failed",
	})
	expect(chat.inert).toBe(false)
	chat.inert = true
	await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0 })
	expect(chat.inert).toBe(true)
	page.dispose()
})

test("fills and selects ordinary controls even when their ID or test ID is payment", async () => {
	document.body.innerHTML =
		'<main><input data-testid="payment"><select id="payment"><option>Pay on delivery</option></select></main>'
	const page = newPage()
	const tools = toolsFor(page)
	const input = document.querySelector("input")!
	setRect(input, 20, 40)
	controllerState.element = input
	expect(
		await execute(tools, {
			action: "fill",
			snapshot: await observeSnapshot(tools),
			index: 0,
			text: "Ada",
		}),
	).toMatchObject({ status: "dispatched" })
	const select = document.querySelector("select")!
	setRect(select, 20, 40)
	controllerState.element = select
	expect(
		await execute(tools, {
			action: "select",
			snapshot: await observeSnapshot(tools),
			index: 0,
			option: "Pay on delivery",
		}),
	).toMatchObject({ status: "dispatched" })
	page.dispose()
})

test("rejects a control with a sensitive ARIA label even when the controller returns it", async () => {
	document.body.innerHTML = '<main><input aria-label="API secret"></main>'
	const input = document.querySelector("input")!
	setRect(input, 20, 40)
	controllerState.element = input
	const page = newPage()
	const tools = toolsFor(page)
	try {
		expect(
			await execute(tools, {
				action: "fill",
				snapshot: await observeSnapshot(tools),
				index: 0,
				text: "example",
			}),
		).toMatchObject({ status: "failed", message: "Target is outside the permitted page." })
	} finally {
		page.dispose()
	}
})

test("releases modal chat dialogs while working on the page", async () => {
	document.body.innerHTML = ""
	const dialog = document.createElement("dialog")
	dialog.innerHTML = '<button id="inside">Inside</button>'
	document.body.append(dialog)
	const inside = document.querySelector("#inside") as HTMLElement
	inside.focus()
	dialog.show()
	// The browser reports the chat dialog as modal until the page tool releases it.
	let modal = true
	Object.defineProperty(dialog, "matches", {
		configurable: true,
		value: (selector: string) => selector === ":modal" && modal && ((modal = false), true),
	})
	const page = newPage({ exclude: [dialog] })
	const tools = toolsFor(page)
	await execute(tools, { action: "observe" })
	expect(dialog.open).toBe(true)
	page.dispose()
	expect(dialog.open).toBe(true)
})
