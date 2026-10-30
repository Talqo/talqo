import { getSession } from "@/api/generated/identity/identity.ts"
import { resolveDashboardSession } from "@/features/authentication/session"
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router"

import { DashboardLayout } from "./-dashboard-layout"

export const Route = createFileRoute("/dashboard")({
	beforeLoad: async () => {
		const outcome = await resolveDashboardSession(async () => (await getSession()).data.user)
		if (outcome === "login") throw redirect({ to: "/login" })
		if (outcome === "passwordChange") throw redirect({ to: "/force-password-change" })
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
