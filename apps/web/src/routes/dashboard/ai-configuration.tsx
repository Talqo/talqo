import { AiConfigurationPage } from "@/features/ai-configuration/ai-configuration-page.tsx"
import { requirePermission } from "@/features/permissions/require-permission"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/ai-configuration")({
	beforeLoad: requirePermission("ai_provider:manage"),
	component: AiConfigurationPage,
})
