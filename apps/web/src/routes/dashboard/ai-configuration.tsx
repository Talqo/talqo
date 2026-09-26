import { getAccess } from "@/api/generated/roles/roles.ts"
import { AiConfigurationPage } from "@/features/ai-configuration/ai-configuration-page.tsx"
import { createFileRoute, redirect } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/ai-configuration")({
	beforeLoad: async () => {
		let access
		try {
			access = await getAccess()
		} catch {
			throw redirect({ to: "/login" })
		}
		if (!access.data.permissions.includes("ai_provider:manage")) throw redirect({ to: "/dashboard" })
	},
	component: AiConfigurationPage,
})
