import { parseAgentsParam } from "@/features/statistics/agents-search"
import { createFileRoute, redirect } from "@tanstack/react-router"

// The analytics page was merged into the statistics dashboard; old links redirect, filter intact.
export const Route = createFileRoute("/dashboard/analytics")({
	validateSearch: (search: Record<string, unknown>): { agents?: string[] } => ({
		agents: parseAgentsParam(search.agents),
	}),
	beforeLoad: ({ search }) => {
		throw redirect({ to: "/dashboard", search: { agents: search.agents }, replace: true })
	},
})
