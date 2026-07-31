import { createFileRoute, Outlet } from "@tanstack/react-router"

import { DashboardLayout } from "./-dashboard-layout"

export const Route = createFileRoute("/dashboard")({
	component: DashboardRouteComponent,
})

function DashboardRouteComponent() {
	return (
		<DashboardLayout>
			<Outlet />
		</DashboardLayout>
	)
}
