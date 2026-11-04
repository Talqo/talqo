import { requirePermission } from "@/features/permissions/require-permission"
import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/team/roles")({
	beforeLoad: requirePermission("roles:manage"),
	component: Outlet,
})
