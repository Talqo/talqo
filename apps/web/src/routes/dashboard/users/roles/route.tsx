import { requirePermission } from "@/features/permissions/require-permission"
import { createFileRoute, Outlet } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/users/roles")({
	beforeLoad: requirePermission("roles:manage"),
	component: Outlet,
})
