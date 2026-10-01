import { useGetMyPermissions } from "@/api/generated/roles/roles.ts"
import { PageHeader } from "@/components/page-header"
import { InviteMemberDialog } from "@/features/users/components/invite-member-dialog.tsx"
import { UsersPanel } from "@/features/users/components/users-panel.tsx"
import { createFileRoute } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/users")({
	component: UsersPage,
})

function UsersPage() {
	const { t } = useTranslation()
	// The nav item is admin-only, so this only matters for a direct link.
	const isAdmin = useGetMyPermissions().data?.data.permissions.includes("admin") ?? false

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader
				title={t("users.heading")}
				description={t("users.subheading")}
				actions={isAdmin ? <InviteMemberDialog /> : undefined}
			/>
			<UsersPanel />
		</div>
	)
}
