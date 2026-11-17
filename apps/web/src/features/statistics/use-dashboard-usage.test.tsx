import type { AgentLine } from "@/features/statistics/components/stats-charts"
import type { StatsOverview } from "@/features/statistics/page-stats"
import type { Root } from "react-dom/client"

import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterEach, beforeEach, expect, test } from "bun:test"

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register({ url: "http://localhost/" })
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { useDashboardUsage } = await import("./use-dashboard-usage")
const { createRoot } = await import("react-dom/client")
const { act, useEffect } = await import("react")

const OVERVIEW: StatsOverview = {
	days: 7,
	totals: { conversations: 0, messages: 0, inputTokens: 0, outputTokens: 0 },
	daily: [],
	agentDaily: [],
	agents: [],
	active: [],
	activeWindowMinutes: 5,
}
const LINES: AgentLine[] = [{ id: "a", name: "A", color: "#000" }]

let usage: ReturnType<typeof useDashboardUsage>
let host: HTMLDivElement
let root: Root

function Harness() {
	const current = useDashboardUsage({
		overview: OVERVIEW,
		agentLines: LINES,
		selection: ["a", "a"],
		allIds: ["a", "b"],
	})
	useEffect(() => {
		usage = current
	})
	return null
}

beforeEach(async () => {
	host = document.createElement("div")
	document.body.append(host)
	root = createRoot(host)
	await act(async () => root.render(<Harness />))
})

afterEach(async () => {
	await act(async () => root.unmount())
	host.remove()
})

test("deduplicates repeated agent ids in the selection", () => {
	expect(usage.selectedIds).toEqual(["a"])
	expect(usage.rangeIsEmpty).toBe(false)
})
