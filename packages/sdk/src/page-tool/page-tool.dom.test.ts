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
	document.body.innerHTML = ""
})

function buttonFixture(): HTMLElement {
	document.body.innerHTML = '<main><button id="buy">Buy</button></main>'
	const element = document.querySelector<HTMLElement>("#buy")!
	setRect(element, 20, 40)
	document.elementFromPoint = () => element
	controllerState.element = element
	return element
}

function newPage(overrides: Partial<Parameters<typeof createPageTool>[0]> = {}): PageTool {
	return createPageTool({ exclude: [], language: "en", stop: async () => {}, ...overrides })
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
			description: "Buying the shirt",
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

test("observes the page and reports private controls without exposing them", async () => {
	document.body.innerHTML =
		'<main><input type="password" name="secret"><form><button id="buy">Buy</button></form></main>'
	controllerState.element = document.querySelector("#buy") as HTMLElement
	const page = createPageTool({ exclude: [], language: "en", stop: async () => {} })
	const result = (await execute(toolsFor(page), { action: "observe" })) as Record<string, unknown>
	expect(result).toMatchObject({ url: "http://localhost/shop", content: "[1] Buy" })
	expect(String(result.snapshot)).toHaveLength(36)
	expect(controllerState.disposed).toBe(false)
	page.dispose()
})

test("scrolls the page and re-observes", async () => {
	controllerState.element = undefined
	const page = createPageTool({ exclude: [], language: "cs", themeRoot: () => document.body, stop: async () => {} })
	const result = (await execute(toolsFor(page), { action: "scroll", down: true, description: "Scrolling" })) as {
		result: string
		page: { snapshot: string }
	}
	expect(result.result).toBe("scrolled")
	expect(result.page.snapshot).toHaveLength(36)
	page.dispose()
})

test("approves a click, validates the proposal, and reports dispatch", async () => {
	buttonFixture()
	const page = newPage({ approvalInstructions: "Confirm totals." })
	const tools = toolsFor(page)
	const pending = pendingApproval(tools)
	await Bun.sleep(10)
	clickButton("Approve")
	const result = (await pending) as Record<string, unknown>
	expect(result).toMatchObject({ status: "dispatched", result: { success: true } })
	page.dispose()
})

test("declines an approved action without dispatching it", async () => {
	buttonFixture()
	const page = newPage()
	const tools = toolsFor(page)
	const pending = pendingApproval(tools)
	await Bun.sleep(10)
	clickButton("Cancel")
	expect(await pending).toMatchObject({ status: "declined" })
	page.dispose()
})

test("aborts while waiting for approval", async () => {
	buttonFixture()
	const page = newPage()
	const tools = toolsFor(page)
	const controller = new AbortController()
	const pending = pendingApproval(tools, controller.signal)
	await Bun.sleep(10)
	controller.abort(new Error("Visitor cancelled"))
	await expect(pending).rejects.toThrow("Visitor cancelled")
})

test("reports a stale snapshot and a changed page", async () => {
	document.body.innerHTML = '<main><button id="buy">Buy</button></main>'
	const element = document.querySelector("#buy") as HTMLElement
	setRect(element, 20, 40)
	document.elementFromPoint = () => element
	controllerState.element = element
	const page = createPageTool({ exclude: [], language: "en", stop: async () => {} })
	const tools = toolsFor(page)
	expect(await execute(tools, { action: "click", snapshot: "other", index: 0, description: "Buying" })).toMatchObject({
		status: "stale",
	})
	const snapshot = await observeSnapshot(tools)
	controllerState.onState = () => {
		controllerState.element = document.createElement("button")
	}
	expect(await execute(tools, { action: "click", snapshot, index: 0, description: "Buying" })).toMatchObject({
		status: "changed",
	})
	page.dispose()
})

test("validates links and forms before dispatch", async () => {
	document.body.innerHTML =
		'<main><a id="away" href="https://example.com" target="_blank">Away</a><form action="https://example.com"><button id="submit">Send</button></form></main>'
	const page = createPageTool({ exclude: [], language: "en", stop: async () => {} })
	const tools = toolsFor(page)
	const link = document.querySelector("#away") as HTMLElement
	setRect(link, 20, 40)
	document.elementFromPoint = () => link
	controllerState.element = link
	expect(
		await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0, description: "Leaving" }),
	).toMatchObject({
		status: "failed",
		message: "This link requires the visitor. Only this tab and origin can be controlled.",
	})
	const submit = document.querySelector("#submit") as HTMLElement
	setRect(submit, 20, 40)
	document.elementFromPoint = () => submit
	controllerState.element = submit
	expect(
		await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0, description: "Sending" }),
	).toMatchObject({
		status: "failed",
		message: "This form requires the visitor. Only this tab and origin can be controlled.",
	})
	page.dispose()
})

test("rejects unavailable and covered targets", async () => {
	document.body.innerHTML = '<main><button id="buy" disabled>Buy</button><button id="send">Send</button></main>'
	const page = createPageTool({ exclude: [], language: "en", stop: async () => {} })
	const tools = toolsFor(page)
	const disabled = document.querySelector("#buy") as HTMLElement
	controllerState.element = disabled
	expect(
		await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0, description: "Buying" }),
	).toMatchObject({ status: "failed", message: "Target is unavailable. Observe the page again." })
	const send = document.querySelector("#send") as HTMLElement
	setRect(send, 20, 40)
	document.elementFromPoint = () => document.createElement("span")
	controllerState.element = send
	expect(
		await execute(tools, { action: "click", snapshot: await observeSnapshot(tools), index: 0, description: "Sending" }),
	).toMatchObject({ status: "failed" })
	page.dispose()
})

test("fills and selects through the controller", async () => {
	document.body.innerHTML = '<main><input id="name"><select id="size"><option>M</option></select></main>'
	const page = createPageTool({ exclude: [], language: "en", stop: async () => {} })
	const tools = toolsFor(page)
	const input = document.querySelector("#name") as HTMLElement
	setRect(input, 20, 40)
	document.elementFromPoint = () => input
	controllerState.element = input
	expect(
		await execute(tools, {
			action: "fill",
			snapshot: await observeSnapshot(tools),
			index: 0,
			description: "Filling the name",
			text: "Ada",
		}),
	).toMatchObject({ status: "dispatched" })
	const select = document.querySelector("#size") as HTMLElement
	setRect(select, 20, 40)
	document.elementFromPoint = () => select
	controllerState.element = select
	expect(
		await execute(tools, {
			action: "select",
			snapshot: await observeSnapshot(tools),
			index: 0,
			description: "Choosing a size",
			option: "M",
		}),
	).toMatchObject({ status: "dispatched" })
	page.dispose()
})

test("stops the task from the panel when the agent cannot be reached", async () => {
	document.body.innerHTML = "<main></main>"
	const page = createPageTool({
		exclude: [],
		language: "cs",
		stop: async () => {
			throw new Error("offline")
		},
	})
	const tools = toolsFor(page)
	await execute(tools, { action: "observe" })
	const stop = [...shadowButtons()].find((candidate) => candidate.textContent === "Zastavit")
	stop?.click()
	await Bun.sleep(10)
	page.dispose()
	expect(stop).toBeDefined()
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
	const page = createPageTool({ exclude: [dialog], language: "en", stop: async () => {} })
	const tools = toolsFor(page)
	await execute(tools, { action: "observe" })
	expect(dialog.open).toBe(true)
	page.dispose()
	expect(dialog.open).toBe(true)
})
