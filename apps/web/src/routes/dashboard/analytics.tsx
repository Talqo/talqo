import { createFileRoute, redirect } from "@tanstack/react-router"

// The analytics page was merged into the statistics dashboard; old links redirect to it,
// keeping the formerly selected agent visible through the dashboard's agent filter.
export const Route = createFileRoute("/dashboard/analytics")({
	validateSearch: (search: Record<string, unknown>): { agent?: string } => ({
		agent: typeof search.agent === "string" ? search.agent : undefined,
	}),
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/dashboard",
			search: { agents: search.agent ? [search.agent] : undefined },
			replace: true,
		})
	},
})
