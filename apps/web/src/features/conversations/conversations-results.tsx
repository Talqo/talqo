import type { ConversationList } from "@/api/generated/models/conversationList.zod.ts"
import type { ConversationSummary } from "@/api/generated/models/conversationSummary.zod.ts"

import { ProblemAlert } from "@/components/problem-alert"
import { formatDay, formatTime } from "@/lib/format-date"
import { Button } from "@talqo/ui/components/button"
import { EmptyState } from "@talqo/ui/components/empty-state"
import { Skeleton } from "@talqo/ui/components/skeleton"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight, MessagesSquare } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { ConversationsSearch } from "./conversations-search"

type DayGroup = { day: string; conversations: Array<ConversationSummary> }

function groupByDay(conversations: Array<ConversationSummary>, language: string): Array<DayGroup> {
	const groups: Array<DayGroup> = []
	for (const conversation of conversations) {
		const day = formatDay(conversation.startedAt, language)
		const last = groups.at(-1)
		if (last?.day === day) last.conversations.push(conversation)
		else groups.push({ day, conversations: [conversation] })
	}
	return groups
}

function ConversationsSkeleton() {
	return (
		<div className="space-y-3">
			<div className="divide-border divide-y rounded-md border">
				{Array.from({ length: 4 }, (_, index) => (
					<div key={index} className="space-y-2 px-4 py-3">
						<Skeleton className="h-4 w-2/3 max-w-full" />
						<Skeleton className="h-3 w-1/2 max-w-full" />
					</div>
				))}
			</div>
		</div>
	)
}

function NoConversations({ filtered }: { filtered: boolean }) {
	const { t } = useTranslation()
	return (
		<EmptyState
			icon={MessagesSquare}
			title={filtered ? t("conversations.emptyFilteredTitle") : t("conversations.emptyTitle")}
			description={filtered ? t("conversations.emptyFilteredDescription") : t("conversations.emptyDescription")}
		/>
	)
}

function PageOutOfRange({ onFirstPage }: { onFirstPage: () => void }) {
	const { t } = useTranslation()
	return (
		<EmptyState
			icon={MessagesSquare}
			title={t("conversations.pageEmptyTitle")}
			description={t("conversations.pageEmptyDescription")}
			actions={
				<Button variant="outline" onClick={onFirstPage}>
					{t("conversations.firstPage")}
				</Button>
			}
		/>
	)
}

function ConversationGroups({
	groups,
	agentNames,
	language,
	search,
}: {
	groups: Array<DayGroup>
	agentNames: Map<string, string>
	language: string
	search: ConversationsSearch
}) {
	const { t } = useTranslation()
	return (
		<>
			{groups.map((group) => (
				<div key={group.day} className="space-y-2">
					<h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{group.day}</h3>
					<ul className="divide-border divide-y rounded-md border">
						{group.conversations.map((conversation) => (
							<li key={conversation.id}>
								<Link
									to="/dashboard/conversations/$conversationId"
									params={{ conversationId: conversation.id }}
									search={search}
									className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3"
								>
									<div className="min-w-0 flex-1 space-y-1">
										<p className="truncate text-sm font-medium">
											{conversation.preview ?? t("conversations.noPreview")}
										</p>
										<p className="text-muted-foreground text-xs">
											{formatTime(conversation.startedAt, language)}
											{" · "}
											{agentNames.get(conversation.agentId) ?? t("conversations.unknownAgent")}
											{" · "}
											{t("conversations.messageCount", { count: conversation.messageCount })}
										</p>
									</div>
									<ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
								</Link>
							</li>
						))}
					</ul>
				</div>
			))}
		</>
	)
}

function ConversationPagination({
	page,
	pageCount,
	onPageChange,
}: {
	page: number
	pageCount: number
	onPageChange: (page: number) => void
}) {
	const { t } = useTranslation()
	return (
		<nav aria-label={t("conversations.pagination")} className="flex items-center justify-between gap-2">
			<Button variant="outline" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
				<ChevronLeft className="size-4" aria-hidden="true" />
				{t("conversations.previousPage")}
			</Button>
			<span className="text-muted-foreground text-sm">{t("conversations.pageOf", { page, pages: pageCount })}</span>
			<Button variant="outline" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount}>
				{t("conversations.nextPage")}
				<ChevronRight className="size-4" aria-hidden="true" />
			</Button>
		</nav>
	)
}

function NoResults({ filtered, onFirstPage, page }: { filtered: boolean; onFirstPage: () => void; page: number }) {
	if (page > 1) return <PageOutOfRange onFirstPage={onFirstPage} />
	return <NoConversations filtered={filtered} />
}

export function ConversationResults({
	agentNames,
	error,
	filtered,
	isPending,
	language,
	noAgentSelected,
	onFirstPage,
	onPageChange,
	onRetry,
	page,
	result,
	search,
}: {
	agentNames: Map<string, string>
	error: unknown
	filtered: boolean
	isPending: boolean
	language: string
	noAgentSelected: boolean
	onFirstPage: () => void
	onPageChange: (page: number) => void
	onRetry: () => void
	page: number
	result: ConversationList | undefined
	search: ConversationsSearch
}) {
	const { t } = useTranslation()
	if (noAgentSelected)
		return <output className="text-muted-foreground block">{t("conversations.noAgentSelected")}</output>
	if (isPending) return <ConversationsSkeleton />
	if (!result) return <ProblemAlert error={error} onRetry={onRetry} />
	if (result.conversations.length === 0) return <NoResults filtered={filtered} onFirstPage={onFirstPage} page={page} />
	const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize))
	return (
		<>
			<ProblemAlert error={error} onRetry={onRetry} />
			<ConversationGroups
				agentNames={agentNames}
				groups={groupByDay(result.conversations, language)}
				language={language}
				search={search}
			/>
			{pageCount > 1 && <ConversationPagination onPageChange={onPageChange} page={page} pageCount={pageCount} />}
		</>
	)
}
