import { RolePage } from "@/features/roles/role-page"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/users/roles/$roleId")({ component: RoleSettings })

function RoleSettings() {
	const { roleId } = Route.useParams()
	return <RolePage key={roleId} roleId={roleId} />
}
