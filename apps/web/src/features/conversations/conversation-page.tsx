import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetConversation } from "@/api/generated/conversation/conversation.ts"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { formatDateTime } from "@/lib/format-date"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationsSearch } from "./conversations-search"

import { Transcript } from "./transcript"

export function ConversationPage({
	conversationId,
	listSearch,
}: {
	conversationId: string
	listSearch: ConversationsSearch
}) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const query = useGetConversation(conversationId)
	const agents = useListAgents().data?.data.agents
	const conversation = query.data?.data.conversation
	const notFound = query.error?.info?.code === "conversation-not-found"
	const agentName = agents?.find((agent) => agent.id === conversation?.agentId)?.name

	return (
		<div className="space-y-6">
			<Button
				render={<Link to="/dashboard/conversations" search={listSearch} />}
				nativeButton={false}
				variant="ghost"
				className="-ml-2"
			>
				<ArrowLeft className="size-4" aria-hidden="true" />
				{t("conversations.backToConversations")}
			</Button>

			{query.isPending ? (
				<output className="text-muted-foreground block">{t("conversations.loadingTranscript")}</output>
			) : !conversation || notFound ? (
				<ProblemAlert error={query.error} onRetry={notFound ? undefined : () => void query.refetch()} />
			) : (
				<>
					<PageHeader
						title={t("conversations.heading")}
						description={t("conversations.startedAt", {
							date: formatDateTime(conversation.startedAt, language),
							agent: agentName ?? t("conversations.unknownAgent"),
						})}
					/>
					<ProblemAlert error={query.error} onRetry={() => void query.refetch()} />
					<Transcript messages={conversation.messages} />
				</>
			)}
		</div>
	)
}
