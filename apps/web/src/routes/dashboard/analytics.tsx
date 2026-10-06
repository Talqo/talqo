import { createFileRoute, redirect } from "@tanstack/react-router"

// The analytics page was merged into the statistics dashboard; old links redirect to it.
// The agent selection is page-local state, so the redirect carries no filter payload.
export const Route = createFileRoute("/dashboard/analytics")({
	beforeLoad: () => {
		throw redirect({ to: "/dashboard", replace: true })
	},
})
