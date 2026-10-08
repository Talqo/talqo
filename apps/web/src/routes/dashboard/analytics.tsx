import { parseAgentsParam } from "@/features/statistics/agents-search"
import { parseDaysParam, type StatsDays } from "@/features/statistics/ranges"
import { createFileRoute, redirect } from "@tanstack/react-router"

// The analytics page was merged into the statistics dashboard; old links redirect, filters intact.
export const Route = createFileRoute("/dashboard/analytics")({
	validateSearch: (search: Record<string, unknown>): { agents?: string[]; days?: StatsDays } => ({
		agents: parseAgentsParam(search.agents),
		days: parseDaysParam(search.days),
	}),
	beforeLoad: ({ search }) => {
		throw redirect({ to: "/dashboard", search: { agents: search.agents, days: search.days }, replace: true })
	},
})
