import { requirePermission } from "@/features/permissions/require-permission"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/users")({
	beforeLoad: requirePermission("users:read"),
})
