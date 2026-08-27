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
		// A null user covers both "never logged in" and "session just invalidated" (e.g. admin reset).
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
