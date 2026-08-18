import { getSession } from "@/api/client.ts"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { DashboardLayout } from "./-dashboard-layout"

export const Route = createFileRoute("/dashboard")({
	beforeLoad: async () => {
		const { user } = await getSession().catch(() => ({ user: null }))
		if (!user) throw redirect({ to: "/login" })
	},
	component: DashboardRouteComponent,
})

function DashboardRouteComponent() {
	return (
		<DashboardLayout>
			<Outlet />
		</DashboardLayout>
	)
}
