import type { ReactNode } from "react"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
await import("@/lib/i18n")
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { agentLineColor, agentLineDashPattern, DailyStatsChart, StatsCards } = await import("./stats-charts")
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

describe("agentLineColor", () => {
	test("cycles the chart palette and repeats only after five agents", () => {
		expect(Array.from({ length: 6 }, (_, index) => agentLineColor(index))).toEqual([
			"var(--chart-1)",
			"var(--chart-2)",
			"var(--chart-3)",
			"var(--chart-4)",
			"var(--chart-5)",
			"var(--chart-1)",
		])
	})
})

describe("agentLineDashPattern", () => {
	test("changes the dash pattern for each group of five agents", () => {
		expect(Array.from({ length: 15 }, (_, index) => agentLineDashPattern(index))).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"6 3",
			"6 3",
			"6 3",
			"6 3",
			"6 3",
			"2 3",
			"2 3",
			"2 3",
			"2 3",
			"2 3",
		])
	})
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

describe("DailyStatsChart", () => {
	test("renders one tab per metric and switches the visible chart", async () => {
		await render(
			<DailyStatsChart
				daily={[
					{ date: "2026-11-01", conversations: 2, messages: 8, tokens: 1200 },
					{ date: "2026-11-02", conversations: 3, messages: 9, tokens: 2400 },
				]}
				agentDaily={[
					{
						agentId: "agent-1",
						date: "2026-11-01",
						conversations: 2,
						messages: 8,
						tokens: 1200,
					},
				]}
				agentLines={[{ color: "var(--chart-1)", id: "agent-1", name: "Shop helper" }]}
				labels={{ conversations: "Conversations", messages: "Messages", tokens: "Tokens" }}
				totalLabel="Total"
				chartTitle={(metric) => `${metric} per day`}
				chartDescription="Each selected agent has its own line."
			/>,
		)

		const tabs = [...host.querySelectorAll<HTMLElement>("[role=tab]")]
		expect(tabs.map((tab) => tab.textContent)).toEqual(["Conversations", "Messages", "Tokens"])
		expect(tabs[0]?.getAttribute("aria-selected")).toBe("true")

		expect(host.querySelector("svg:not([aria-label]) title")?.textContent).toBe("Conversations per day")
		const axisLabels = [...host.querySelectorAll("svg text")].map((node) => node.textContent)
		expect(axisLabels).toContain("Nov 1")
		expect(axisLabels).toContain("Nov 2")
		expect(host.textContent).toContain("Shop helper")

		await act(async () => tabs[1]?.click())

		expect(tabs[1]?.getAttribute("aria-selected")).toBe("true")
		expect(host.querySelector("svg:not([aria-label]) title")?.textContent).toBe("Messages per day")
		expect(host.querySelector("svg:not([aria-label]) desc")?.textContent).toBe("Each selected agent has its own line.")

		await act(async () => tabs[2]?.click())
		expect(tabs[2]?.getAttribute("aria-selected")).toBe("true")
		expect([...host.querySelectorAll("svg text")].some((node) => node.textContent?.endsWith("K"))).toBe(true)
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
