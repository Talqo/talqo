import { getSetupStatus } from "@/api/client.ts"
import { createFileRoute, redirect } from "@tanstack/react-router"

// TODO(landing): the landing page is not ported yet; the login page will replace / later.
export const Route = createFileRoute("/")({
	beforeLoad: async () => {
		const { needsSetup } = await getSetupStatus()
		throw redirect({ to: needsSetup ? "/setup" : "/login" })
	},
	component: () => <p>Loading…</p>,
})
