import { getSetupStatus } from "@/api/generated/roles/roles.ts"
import { PendingPage } from "@/components/page-skeleton"
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		let needsSetup = false
		try {
			const response = await getSetupStatus()
			needsSetup = response.data.needsSetup
		} catch {
			throw redirect({ to: "/login" })
		}
		throw redirect({ to: needsSetup ? "/setup" : "/login" })
	},
	component: PendingPage,
})
