import { RolesPage } from "@/features/roles/roles-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/team/roles/")({ component: RolesPage })
