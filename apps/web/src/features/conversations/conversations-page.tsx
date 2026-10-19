import type { ConversationSummary } from "@/api/generated/models/conversationSummary.zod.ts"

import { useListAgents } from "@/api/generated/agent/agent.ts"
import { useListConversations } from "@/api/generated/conversation/conversation.ts"
import { PageHeader } from "@/components/page-header"
import { ProblemAlert } from "@/components/problem-alert"
import { AgentFilter } from "@/features/statistics/components/agent-filter"
import { agentLineColor } from "@/features/statistics/components/stats-charts"
import { useLanguage } from "@/lib/use-language"
import { Badge } from "@talqo/ui/components/badge"
import { Button } from "@talqo/ui/components/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@talqo/ui/components/select"
import { keepPreviousData } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"

import type { ConversationsSearch } from "./conversations-search"

import { conversationDay, formatConversationTime } from "./conversation-dates"

type Props = {
	search: ConversationsSearch
	onSearchChange: (search: ConversationsSearch) => void
}

type DayGroup = { day: string; conversations: ConversationSummary[] }

function groupByDay(conversations: ConversationSummary[], language: string): DayGroup[] {
	const groups: DayGroup[] = []
	for (const conversation of conversations) {
		const day = conversationDay(conversation.startedAt, language)
		const last = groups.at(-1)
		if (last?.day === day) last.conversations.push(conversation)
		else groups.push({ day, conversations: [conversation] })
	}
	return groups
}

export function ConversationsPage({ search, onSearchChange }: Props) {
	const { t } = useTranslation()
	const { language } = useLanguage()
	const resultsHeading = useRef<HTMLHeadingElement>(null)
	const page = search.page ?? 1
	const agentsQuery = useListAgents()
	const agentLines = useMemo(
		() =>
			(agentsQuery.data?.data.agents ?? []).map((agent, index) => ({
				id: agent.id,
				name: agent.name,
				color: agentLineColor(index),
			})),
		[agentsQuery.data],
	)
	const agentNames = new Map(agentLines.map((line) => [line.id, line.name]))
	const noAgentSelected = search.agents?.length === 0
	const conversationsQuery = useListConversations(
		{ agentId: search.agents, needsAttention: search.attention ? "true" : undefined, page },
		// The previous page stays on screen while the next one loads, so the pager never jumps.
		{ query: { enabled: !noAgentSelected, placeholderData: keepPreviousData } },
	)
	const result = conversationsQuery.data?.data
	const pageCount = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1

	function goToPage(next: number) {
		onSearchChange({ ...search, page: next > 1 ? next : undefined })
		resultsHeading.current?.focus()
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			<PageHeader title={t("conversations.listHeading")} description={t("conversations.listDescription")} />

			<div className="flex flex-wrap items-center gap-4">
				{agentLines.length > 0 && (
					<AgentFilter
						agentLines={agentLines}
						selectedIds={search.agents ?? agentLines.map((line) => line.id)}
						onChange={(ids) =>
							onSearchChange({
								...search,
								agents: ids.length === agentLines.length ? undefined : ids,
								page: undefined,
							})
						}
					/>
				)}
				<div className="flex items-center gap-2">
					<span className="text-muted-foreground text-sm font-medium">{t("conversations.showLabel")}</span>
					<Select
						value={search.attention ? "attention" : "all"}
						onValueChange={(value) =>
							onSearchChange({ ...search, attention: value === "attention" ? true : undefined, page: undefined })
						}
					>
						<SelectTrigger size="sm" aria-label={t("conversations.showLabel")} className="min-w-40">
							<SelectValue>
								{search.attention ? t("conversations.showAttention") : t("conversations.showAll")}
							</SelectValue>
						</SelectTrigger>
						<SelectContent align="start">
							<SelectItem value="all">{t("conversations.showAll")}</SelectItem>
							<SelectItem value="attention">{t("conversations.showAttention")}</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<section className="space-y-4" aria-busy={conversationsQuery.isFetching}>
				<h2 ref={resultsHeading} tabIndex={-1} className="text-sm font-medium outline-none">
					{result ? t("conversations.total", { count: result.total }) : t("conversations.listHeading")}
				</h2>

				{noAgentSelected ? (
					<p className="text-muted-foreground" role="status">
						{t("conversations.noAgentSelected")}
					</p>
				) : conversationsQuery.isPending ? (
					<p className="text-muted-foreground" role="status">
						{t("conversations.loading")}
					</p>
				) : !result ? (
					<ProblemAlert error={conversationsQuery.error} onRetry={() => void conversationsQuery.refetch()} />
				) : result.conversations.length === 0 && page > 1 ? (
					<div className="space-y-2">
						<p className="text-muted-foreground" role="status">
							{t("conversations.pageEmpty")}
						</p>
						<Button variant="outline" onClick={() => goToPage(1)}>
							{t("conversations.firstPage")}
						</Button>
					</div>
				) : result.conversations.length === 0 ? (
					<p className="text-muted-foreground" role="status">
						{search.attention || search.agents ? t("conversations.emptyFiltered") : t("conversations.empty")}
					</p>
				) : (
					<>
						<ProblemAlert error={conversationsQuery.error} onRetry={() => void conversationsQuery.refetch()} />
						{groupByDay(result.conversations, language).map((group) => (
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
														{formatConversationTime(conversation.startedAt, language)}
														{" · "}
														{agentNames.get(conversation.agentId) ?? t("conversations.unknownAgent")}
														{" · "}
														{t("conversations.messageCount", { count: conversation.messageCount })}
													</p>
												</div>
												{conversation.needsAttention && (
													<Badge variant="destructive">{t("conversations.needsAttention")}</Badge>
												)}
												<ChevronRight className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
											</Link>
										</li>
									))}
								</ul>
							</div>
						))}
						{pageCount > 1 && (
							<nav aria-label={t("conversations.pagination")} className="flex items-center justify-between gap-2">
								<Button variant="outline" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
									<ChevronLeft className="size-4" aria-hidden="true" />
									{t("conversations.previousPage")}
								</Button>
								<span className="text-muted-foreground text-sm">
									{t("conversations.pageOf", { page, pages: pageCount })}
								</span>
								<Button variant="outline" onClick={() => goToPage(page + 1)} disabled={page >= pageCount}>
									{t("conversations.nextPage")}
									<ChevronRight className="size-4" aria-hidden="true" />
								</Button>
							</nav>
						)}
					</>
				)}
			</section>
		</div>
	)
}
