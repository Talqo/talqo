import { ConversationsPage } from "@/features/conversations/conversations-page"
import { parseConversationsSearch } from "@/features/conversations/conversations-search"
import { requirePermission } from "@/features/permissions/require-permission"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/conversations/")({
	beforeLoad: requirePermission("conversations:read"),
	validateSearch: parseConversationsSearch,
	component: ConversationsRoute,
})

function ConversationsRoute() {
	const navigate = Route.useNavigate()
	return <ConversationsPage search={Route.useSearch()} onSearchChange={(search) => void navigate({ search })} />
}
