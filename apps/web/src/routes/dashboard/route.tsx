import { getSession } from "@/api/generated/identity/identity.ts"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { DashboardLayout } from "./-dashboard-layout"

export const Route = createFileRoute("/dashboard")({
	beforeLoad: async () => {
		let loggedIn = false
		try {
			loggedIn = (await getSession()).data.user !== null
		} catch {
			loggedIn = false
		}
		if (!loggedIn) throw redirect({ to: "/login" })
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
