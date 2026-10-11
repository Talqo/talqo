import { useGetConversation } from "@/api/generated/conversation/conversation.ts"
import { PageHeader } from "@/components/page-header"
import { formatConversationDate } from "@/features/conversations/conversations-panel"
import { Transcript } from "@/features/conversations/transcript"
import { requirePermission } from "@/features/permissions/require-permission"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

export const Route = createFileRoute("/dashboard/agent/$agentId_/conversations/$conversationId")({
	beforeLoad: requirePermission("agents:read"),
	component: ConversationPage,
})

const NOT_FOUND_STATUS = 404

function ConversationPage() {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const { agentId, conversationId } = Route.useParams()
	const { data, error, isLoading, isFetching, refetch } = useGetConversation(agentId, conversationId)
	const conversation = data?.data.conversation

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<Button
				render={<Link to="/dashboard/agent/$agentId" params={{ agentId }} search={{ tab: "conversations" }} />}
				nativeButton={false}
				variant="ghost"
				className="-ml-2"
			>
				<ArrowLeft className="size-4" />
				{t("conversations.backToConversations")}
			</Button>

			{isLoading ? (
				<p className="text-muted-foreground">{t("conversations.loadingTranscript")}</p>
			) : error?.status === NOT_FOUND_STATUS ? (
				<p className="text-muted-foreground">{t("problems.conversation-not-found")}</p>
			) : !conversation ? (
				<div className="space-y-2">
					<p role="alert" className="text-destructive text-sm">
						{t("conversations.transcriptLoadFailed")}
					</p>
					<Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
						{t("conversations.retry")}
					</Button>
				</div>
			) : (
				<>
					<PageHeader
						title={t("conversations.heading")}
						description={t("conversations.startedAt", {
							date: formatConversationDate(conversation.startedAt, language),
						})}
					/>
					<Transcript messages={conversation.messages} />
				</>
			)}
		</div>
	)
}
