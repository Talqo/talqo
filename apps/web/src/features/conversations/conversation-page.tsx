import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useGetConversation } from "@/api/generated/conversation/conversation.ts"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { formatDateTime } from "@/lib/format-date"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { Link } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationsSearch } from "./conversations-search"

import { Transcript } from "./transcript"

const PREVIEW_LIMIT = 80

function previewOf(text: string | undefined): string | undefined {
	const trimmed = text?.trim()
	if (!trimmed) return undefined
	return trimmed.length > PREVIEW_LIMIT ? `${trimmed.slice(0, PREVIEW_LIMIT)}…` : trimmed
}

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
	const preview = previewOf(conversation?.messages.find((message) => message.role === "user")?.text)

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
				<div className="space-y-6">
					<output className="sr-only">{t("conversations.loadingTranscript")}</output>
					<div className="space-y-3">
						<Skeleton className="h-8 w-56 max-w-full" />
						<Skeleton className="h-4 w-80 max-w-full" />
					</div>
					<div className="space-y-4">
						<Skeleton className="h-20 w-3/4" />
						<Skeleton className="ml-auto h-20 w-3/4" />
						<Skeleton className="h-20 w-3/4" />
					</div>
				</div>
			) : !conversation || notFound ? (
				<ProblemAlert error={query.error} onRetry={notFound ? undefined : () => void query.refetch()} />
			) : (
				<>
					<PageHeader
						title={preview ?? agentName ?? t("conversations.unknownAgent")}
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
