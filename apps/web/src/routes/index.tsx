import { getSetupStatus } from "@/api/generated/roles/roles.ts"
import { PendingPage } from "@/components/page-skeleton"
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const response = await getSetupStatus()
		throw redirect({ to: response.data.needsSetup ? "/setup" : "/login" })
	},
	component: PendingPage,
})
