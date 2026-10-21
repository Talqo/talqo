import { ConversationPage } from "@/features/conversations/conversation-page"
import { parseConversationsSearch } from "@/features/conversations/conversations-search"
import { requirePermission } from "@/features/permissions/require-permission"
import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/dashboard/conversations/$conversationId")({
	beforeLoad: requirePermission("conversations:read"),
	validateSearch: parseConversationsSearch,
	component: ConversationRoute,
})

function ConversationRoute() {
	return <ConversationPage conversationId={Route.useParams().conversationId} listSearch={Route.useSearch()} />
}
