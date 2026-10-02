import { AiConfigurationPage } from "@/features/ai-configuration/ai-configuration-page.tsx"
import { createFileRoute } from "@tanstack/react-router"

// The dashboard layout already redirects signed-out callers, and the page renders
// AccessDenied for callers without ai_provider:manage, so this route needs no guard.
export const Route = createFileRoute("/dashboard/ai-configuration")({
	component: AiConfigurationPage,
})
