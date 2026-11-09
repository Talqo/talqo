import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, jest, mock, spyOn, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { usePreserveScrollOnOpen } = await import("./use-preserve-scroll-on-open")
const { createRoot } = await import("react-dom/client")
const { act, useEffect } = await import("react")

const scrollYDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY")

let host: HTMLDivElement
let root: Root
let hook: ReturnType<typeof usePreserveScrollOnOpen>
let scrollCalls: ScrollToOptions[]

function Harness() {
	const api = usePreserveScrollOnOpen()
	useEffect(() => {
		hook = api
	})
	return null
}

function setScrollY(value: number) {
	Object.defineProperty(window, "scrollY", { configurable: true, value })
}

async function renderHook() {
	await act(async () => root.render(<Harness />))
}

async function advance(milliseconds: number) {
	await act(async () => jest.advanceTimersByTime(milliseconds))
}

beforeEach(async () => {
	jest.useFakeTimers()
	setScrollY(0)
	scrollCalls = []
	spyOn(window, "scrollTo").mockImplementation((options?: ScrollToOptions | number, y?: number) => {
		scrollCalls.push(typeof options === "number" ? { left: options, top: y } : (options ?? {}))
	})
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	await renderHook()
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	if (scrollYDescriptor) Object.defineProperty(window, "scrollY", scrollYDescriptor)
	else Reflect.deleteProperty(window, "scrollY")
	jest.useRealTimers()
	mock.restore()
})

describe("usePreserveScrollOnOpen", () => {
	test("does not restore the scroll when the trigger was already at the top", async () => {
		await act(async () => hook.capturePreOpenScroll())
		await act(async () => hook.onOpenChange(true))
		await advance(400)

		expect(scrollCalls).toEqual([])
	})

	test("restores the pre-open scroll until it sticks", async () => {
		setScrollY(240)
		await act(async () => hook.capturePreOpenScroll())
		setScrollY(0)
		await act(async () => hook.onOpenChange(true))

		await advance(120)
		expect(scrollCalls).toEqual([{ top: 240 }])

		setScrollY(240)
		await advance(240)
		expect(scrollCalls).toHaveLength(1)
	})

	test("stops restoring once the user scrolls", async () => {
		setScrollY(240)
		await act(async () => hook.capturePreOpenScroll())
		setScrollY(80)
		await act(async () => hook.onOpenChange(true))
		await advance(120)

		expect(scrollCalls).toEqual([])
	})

	test("cancels a pending restore when the menu closes or the consumer unmounts", async () => {
		setScrollY(240)
		await act(async () => hook.capturePreOpenScroll())
		setScrollY(0)
		await act(async () => hook.onOpenChange(true))
		await act(async () => hook.onOpenChange(false))
		await advance(500)
		expect(scrollCalls).toEqual([])

		await act(async () => hook.onOpenChange(true))
		await advance(120)
		expect(scrollCalls).toHaveLength(1)
		await act(async () => root.render(null))
		await advance(500)
		expect(scrollCalls).toHaveLength(1)
	})
})
