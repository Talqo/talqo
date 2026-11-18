import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test"

let schedule: (() => void) | undefined
let positions: { x: number; y: number }[] = [{ x: 120, y: 80 }]
let fail = false
let cleaned = false

void mock.module("@floating-ui/dom", () => ({
	autoUpdate: (_target: Element, _panel: Element, update: () => void) => {
		schedule = update
		return () => {
			cleaned = true
		}
	},
	computePosition: async () => {
		if (fail) throw new Error("positioning failed")
		return positions.shift() ?? { x: 0, y: 0 }
	},
	offset: () => ({ name: "offset" }),
	shift: () => ({ name: "shift" }),
}))

import { setRect } from "./test-dom.ts"

const { anchorPageApproval } = await import("./page-tool-position.ts")

beforeAll(() => {
	GlobalRegistrator.register({ url: "http://localhost/" })
})

afterAll(() => {
	void GlobalRegistrator.unregister()
})

beforeEach(() => {
	schedule = undefined
	fail = false
	cleaned = false
	positions = [{ x: 120, y: 80 }]
	document.body.innerHTML = ""
})

test("anchors the panel beside a visible target", async () => {
	const panel = document.createElement("div")
	const highlight = document.createElement("div")
	const target = document.createElement("button")
	setRect(panel, 0, 0, 200, 100)
	setRect(target, 800, 120)
	document.body.append(panel, highlight, target)
	anchorPageApproval(panel, highlight, target, [])
	schedule?.()
	await Bun.sleep(0)
	expect(panel.style.left).toBe("120px")
	expect(panel.style.top).toBe("80px")
	expect(highlight.style.left).toBe("800px")
	expect(highlight.style.width).toBe("40px")
})

test("falls back to a free corner when no placement fits", async () => {
	const panel = document.createElement("div")
	const highlight = document.createElement("div")
	const target = document.createElement("button")
	setRect(panel, 0, 0, 200, 100)
	setRect(target, 300, 120)
	document.body.append(panel, highlight, target)
	positions = [{ x: -100, y: -100 }]
	anchorPageApproval(panel, highlight, target, [])
	schedule?.()
	await Bun.sleep(0)
	expect(panel.style.right).toBe("auto")
	expect(panel.style.left).not.toBe("-100px")
})

test("anchors to a corner when the target leaves the viewport", async () => {
	const panel = document.createElement("div")
	const highlight = document.createElement("div")
	const target = document.createElement("button")
	setRect(panel, 0, 0, 200, 100)
	setRect(target, 300, -200)
	document.body.append(panel, highlight, target)
	anchorPageApproval(panel, highlight, target, [])
	schedule?.()
	await Bun.sleep(0)
	expect(panel.style.left).not.toBe("")
})

test("ignores overlapping obstacle rectangles and recovers from failures", async () => {
	const panel = document.createElement("div")
	const highlight = document.createElement("div")
	const target = document.createElement("button")
	const obstacle = document.createElement("dialog")
	setRect(panel, 0, 0, 200, 100)
	setRect(target, 300, 120)
	setRect(obstacle, 100, 60, 400, 400)
	document.body.append(panel, highlight, target, obstacle)
	fail = true
	const cleanup = anchorPageApproval(panel, highlight, target, [obstacle])
	schedule?.()
	await Bun.sleep(0)
	expect(panel.style.left).not.toBe("")
	cleanup()
	expect(cleaned).toBe(true)
})
