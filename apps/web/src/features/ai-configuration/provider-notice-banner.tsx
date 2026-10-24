import { useGetAiProviderConfiguration } from "@/api/generated/ai-providers/ai-providers.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { Button } from "@talqo/ui/components/button"
import { cn } from "@talqo/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

import { providerNotice } from "./provider-notice"

// Only provider managers can read or fix the configuration, so only they see the prompt.
export function ProviderNoticeBanner() {
	const { t } = useTranslation()
	const canManageProvider = useGetMyPermissions().data?.data.permissions.includes("ai_provider:manage") ?? false
	const notice = providerNotice(useGetAiProviderConfiguration({ query: { enabled: canManageProvider } }))
	if (!canManageProvider || notice === undefined) return null
	return (
		<div
			className={cn(
				"rounded-surface p-surface-padding flex flex-wrap items-center justify-between gap-3 border text-sm",
				// Missing setup is onboarding; only a failed check is an error.
				notice === "missing"
					? "border-border bg-muted/40 text-foreground"
					: "border-destructive/30 bg-destructive/10 text-destructive",
			)}
		>
			<output className="block">
				{t(notice === "missing" ? "dashboard.aiProviderMissing" : "dashboard.aiProviderCheckFailed")}
			</output>
			<Button render={<Link to="/dashboard/ai-configuration" />} nativeButton={false} size="sm">
				{t(notice === "missing" ? "dashboard.aiProviderMissingAction" : "dashboard.aiProviderCheckFailedAction")}
			</Button>
		</div>
	)
}
