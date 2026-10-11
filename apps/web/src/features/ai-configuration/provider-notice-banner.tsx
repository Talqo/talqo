import { useGetAiProviderConfiguration } from "@/api/generated/ai-providers/ai-providers.ts"
import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { Button } from "@talqo/ui/components/button"
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
			role="status"
			className="border-destructive/30 bg-destructive/10 text-destructive rounded-surface p-surface-padding flex flex-wrap items-center justify-between gap-3 border text-sm"
		>
			<p>{t(notice === "missing" ? "dashboard.aiProviderMissing" : "dashboard.aiProviderCheckFailed")}</p>
			<Button render={<Link to="/dashboard/ai-configuration" />} nativeButton={false} size="sm">
				{t(notice === "missing" ? "dashboard.aiProviderMissingAction" : "dashboard.aiProviderCheckFailedAction")}
			</Button>
		</div>
	)
}
