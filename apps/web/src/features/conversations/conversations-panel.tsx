import { useListConversationsInfinite } from "@/api/generated/conversation/conversation.ts"
import { getProblemMessage } from "@/lib/problem-message"
import { useLanguage } from "@/lib/use-language"
import { Button } from "@talqo/ui/components/button"
import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"

export function formatConversationDate(value: string, language: string): string {
	return new Date(value).toLocaleString(language, { dateStyle: "medium", timeStyle: "short" })
}

export function ConversationsPanel({ agentId }: { agentId: string }) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const { data, error, isLoading, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
		useListConversationsInfinite(agentId, undefined, {
			query: {
				initialPageParam: undefined,
				getNextPageParam: (page) => page.data.nextCursor ?? undefined,
			},
		})
	const conversations = data?.pages.flatMap((page) => page.data.conversations) ?? []

	return (
		<div className="space-y-4">
			<p className="text-muted-foreground text-sm">{t("conversations.panelDescription")}</p>

			{isLoading ? (
				<p className="text-muted-foreground">{t("conversations.loading")}</p>
			) : error && !conversations.length ? (
				<div className="space-y-2">
					<p role="alert" className="text-destructive text-sm">
						{getProblemMessage(error, t, t("conversations.loadFailed"))}
					</p>
					<Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
						{t("conversations.retry")}
					</Button>
				</div>
			) : !conversations.length ? (
				<p className="text-muted-foreground">{t("conversations.empty")}</p>
			) : (
				<>
					<ul className="divide-border divide-y rounded-md border">
						{conversations.map((conversation) => (
							<li key={conversation.id}>
								<Link
									to="/dashboard/agent/$agentId/conversations/$conversationId"
									params={{ agentId, conversationId: conversation.id }}
									className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3"
								>
									<div className="min-w-0 flex-1 space-y-1">
										<p className="truncate text-sm font-medium">
											{conversation.preview ?? t("conversations.noPreview")}
										</p>
										<p className="text-muted-foreground text-xs">
											{formatConversationDate(conversation.startedAt, language)}
											{" · "}
											{t("conversations.messageCount", { messages: conversation.messageCount })}
										</p>
									</div>
									<ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
								</Link>
							</li>
						))}
					</ul>
					{error && (
						<p role="alert" className="text-destructive text-sm">
							{getProblemMessage(error, t, t("conversations.loadFailed"))}
						</p>
					)}
					{hasNextPage && (
						<Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
							{isFetchingNextPage ? t("conversations.loadingMore") : t("conversations.loadMore")}
						</Button>
					)}
				</>
			)}
		</div>
	)
}
