import { requirePermission } from "@/features/permissions/require-permission"
import { TeamPage } from "@/features/team/team-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/team/")({
	beforeLoad: requirePermission("users:read"),
	component: TeamPage,
})
