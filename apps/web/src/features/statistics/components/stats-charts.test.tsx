import type { ReactNode } from "react"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { DailyStatsChart, StatsCards } = await import("./stats-charts")
const { LanguageProvider } = await import("@/lib/use-language")
const { createRoot } = await import("react-dom/client")
const { act } = await import("react")

const originalResizeObserver = globalThis.ResizeObserver

let host: HTMLDivElement
let root: Root

// Recharts needs a measured container; happy-dom has no layout engine.
class MeasuredResizeObserver {
	constructor(private readonly callback: ResizeObserverCallback) {}

	observe(target: Element) {
		this.callback([{ target, contentRect: { width: 800, height: 280 } } as ResizeObserverEntry], this)
	}

	unobserve() {}
	disconnect() {}
}

async function render(element: ReactNode) {
	await act(async () => root.render(<LanguageProvider>{element}</LanguageProvider>))
}

beforeEach(() => {
	globalThis.ResizeObserver = MeasuredResizeObserver
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
	globalThis.ResizeObserver = originalResizeObserver
})

describe("StatsCards", () => {
	test("formats compact counts and fractional averages separately", async () => {
		await render(
			<StatsCards
				cards={[
					{ format: "compact", label: "Conversations", value: 1300 },
					{ format: "decimal", label: "Messages per conversation", value: 2.45 },
				]}
			/>,
		)

		const values = [...host.querySelectorAll("[data-slot=card]")].map((card) => card.textContent)
		expect(values).toEqual(["Conversations1.3K", "Messages per conversation2.5"])
	})
})

describe("DailyStatsChart tooltip", () => {
	test("leads with the total and zero-fills agents without a point on that day", async () => {
		await render(
			<DailyStatsChart
				daily={[
					{ date: "2026-11-01", conversations: 6, messages: 8, tokens: 1200 },
					{ date: "2026-11-02", conversations: 5, messages: 9, tokens: 2400 },
				]}
				agentDaily={[
					{ agentId: "agent-1", date: "2026-11-01", conversations: 2, messages: 8, tokens: 1200 },
					{ agentId: "agent-2", date: "2026-11-01", conversations: 4, messages: 6, tokens: 800 },
					{ agentId: "agent-2", date: "2026-11-02", conversations: 5, messages: 7, tokens: 900 },
				]}
				agentLines={[
					{ color: "var(--chart-1)", id: "agent-1", name: "Shop helper" },
					{ color: "var(--chart-2)", id: "agent-2", name: "Billing helper" },
				]}
				labels={{ conversations: "Conversations", messages: "Messages", tokens: "Tokens" }}
				totalLabel="Total"
				chartTitle={(metric) => `${metric} per day`}
				chartDescription="Each selected agent has its own line."
			/>,
		)
		const wrapper = host.querySelector<HTMLElement>(".recharts-wrapper")
		if (!wrapper) throw new Error("chart wrapper not rendered")
		const hover = async (clientX: number) => {
			await act(async () => {
				wrapper.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX, clientY: 100 }))
			})
		}
		const items = () =>
			[...host.querySelectorAll(".recharts-tooltip-item")].map((item) => ({
				name: item.querySelector(".recharts-tooltip-item-name")?.textContent,
				value: item.querySelector(".recharts-tooltip-item-value")?.textContent,
			}))

		await hover(100)
		expect(host.querySelector(".recharts-tooltip-label")?.textContent).toBe("Nov 1")
		expect(items()).toEqual([
			{ name: "Total", value: "6" },
			{ name: "Shop helper", value: "2" },
			{ name: "Billing helper", value: "4" },
		])

		await hover(500)
		expect(host.querySelector(".recharts-tooltip-label")?.textContent).toBe("Nov 2")
		expect(items()).toEqual([
			{ name: "Total", value: "5" },
			{ name: "Shop helper", value: "0" },
			{ name: "Billing helper", value: "5" },
		])
	})
})
