import { getSession } from "@/api/generated/identity/identity.ts"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { DashboardLayout } from "./-dashboard-layout"

export const Route = createFileRoute("/dashboard")({
	beforeLoad: async () => {
		let user: { mustChangePassword: boolean } | null = null
		try {
			user = (await getSession()).data.user
		} catch {
			user = null
		}
		// A null user covers never-logged-in and just-invalidated alike.
		if (!user) throw redirect({ to: "/login" })
		if (user.mustChangePassword) throw redirect({ to: "/force-password-change" })
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
