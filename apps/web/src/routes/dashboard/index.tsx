import type { DashboardSearch } from "@/features/statistics/dashboard-page"

import { requirePermission } from "@/features/permissions/require-permission"
import { parseAgentsParam } from "@/features/statistics/agents-search"
import { DashboardIndexPage } from "@/features/statistics/dashboard-page"
import { parseDaysParam } from "@/features/statistics/ranges"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/")({
	validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
		agents: parseAgentsParam(search.agents),
		days: parseDaysParam(search.days),
	}),
	beforeLoad: requirePermission("stats:read"),
	component: DashboardRoute,
})

function DashboardRoute() {
	const navigate = Route.useNavigate()
	return (
		<DashboardIndexPage
			search={Route.useSearch()}
			onSearchChange={(next) =>
				void navigate({
					replace: true,
					resetScroll: false,
					search: (prev) => ({ ...prev, ...next }),
				})
			}
			openAgent={(agentId) =>
				void navigate({
					to: "/dashboard/agent/$agentId",
					params: { agentId },
					search: { tab: undefined },
				})
			}
		/>
	)
}
