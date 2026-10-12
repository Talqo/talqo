import { requirePermission } from "@/features/permissions/require-permission"
import { RolesPage } from "@/features/roles/roles-page.tsx"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/roles")({
	beforeLoad: requirePermission("roles:manage"),
	component: RolesPage,
})
