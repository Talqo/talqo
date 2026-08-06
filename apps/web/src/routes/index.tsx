import { getSetupStatus } from "@/api/client.ts"
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const { needsSetup } = await getSetupStatus()
		throw redirect({ to: needsSetup ? "/setup" : "/login" })
	},
	component: () => <p>Loading…</p>,
})
