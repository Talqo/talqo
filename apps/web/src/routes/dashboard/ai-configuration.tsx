import { AiConfigurationPage } from "@/features/ai-configuration/ai-configuration-page.tsx"
import { requirePermission } from "@/features/permissions/require-permission"
import { createFileRoute } from "@tanstack/react-router"

// Declares its own requirement; the dashboard layout enforces it and renders
// AccessDenied, so this route needs no redirect or in-page gate.
export const Route = createFileRoute("/dashboard/ai-configuration")({
	beforeLoad: requirePermission("ai_provider:manage"),
	component: AiConfigurationPage,
})
