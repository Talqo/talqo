import { getMyRole, getSession } from "@/api/client.ts"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { DashboardLayout } from "./-dashboard-layout"

export const Route = createFileRoute("/dashboard")({
	beforeLoad: async () => {
		const { user } = await getSession()
		// A null user covers both "never logged in" and "session just invalidated" (e.g. admin reset).
		if (!user) throw redirect({ to: "/login" })
		if (user.mustChangePassword) throw redirect({ to: "/force-password-change" })
		const { isAdmin } = await getMyRole()
		return { user, isAdmin }
	},
	component: DashboardRouteComponent,
})

function DashboardRouteComponent() {
	const { isAdmin } = Route.useRouteContext()
	return (
		<DashboardLayout isAdmin={isAdmin}>
			<Outlet />
		</DashboardLayout>
	)
}
